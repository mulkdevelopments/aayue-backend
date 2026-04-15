// services/vendorLdImportService.js
const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');
const pino = require('pino');
const { Pool } = require('pg');
const { randomUUID } = require("crypto");
const { Readable } = require('stream');
require('dotenv').config();

let PQueue = null;
const getPQueue = async () => {
    if (!PQueue) {
        const mod = await import('p-queue');
        PQueue = mod.default || mod;
    }
    return PQueue;
};

const helpers = require('./luxuryImportHelper');
const { normalizeBrandName } = require("../../../utils/normalize");
const { normalizeSize } = require("../../../utils/normalizeSize");
const { categoryHintFromPath, genderHintFromPath } = require("../../../utils/sizeConversion");
const { isBrandExcluded } = require("../excludedBrands");

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10),
});

// STATIC vendor id for THIS pipeline
const VENDOR_ID = '65053474-4e40-44ee-941c-ef5253ea9fc9';

const DEFAULTS = {
    concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
    errFileDir: process.cwd(),
    batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10),
};

// ---------- CATEGORY CREATION (vendor-scoped, idempotent) ----------
async function ensureCategoryPath(client, categoryPath) {
    if (!categoryPath) return null;
    // The CSV uses "Women > Accessories > Lifestyle"
    const parts = categoryPath.split(/->|\/|>|,/).map(p => p.replace(/>/g, '').trim()).filter(Boolean);
    if (!parts.length) return null;

    let parentId = null;
    let parentPath = null;

    for (const part of parts) {
        const slug = helpers.slugify(part);
        const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

        const id = randomUUID();
        const metadata = { created_via_import: true };

        const { rows } = await client.query(
            `
      INSERT INTO categories (
        id, vendor_id, name, slug, parent_id, path, is_active, metadata, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
      ON CONFLICT (vendor_id, path)
      DO UPDATE SET
        parent_id = COALESCE(categories.parent_id, EXCLUDED.parent_id),
        name      = COALESCE(categories.name, EXCLUDED.name),
        slug      = COALESCE(categories.slug, EXCLUDED.slug)
      RETURNING id
      `,
            [id, VENDOR_ID, part, slug, parentId, currentPath, JSON.stringify(metadata)]
        );

        parentId = rows[0].id;
        parentPath = currentPath;
    }

    return parentId;
}

// ---------- PRODUCT + VARIANTS (first row wins on product_sku) ----------
async function upsertProductAndVariant(client, transformed) {
    await client.query('BEGIN');
    try {
        const { product, variants = [], category_path } = transformed;

        let defaultCategoryId = null;
        if (category_path) defaultCategoryId = await ensureCategoryPath(client, category_path);

        // PRODUCT — idempotent on product_sku
        let productId = randomUUID();
        const productSku = product.product_sku || null;
        const productProductId = product.productid || null;

        if (productSku) {
            const insertProductSql = `
        INSERT INTO products (
          id, vendor_id, productid, product_sku, productpartnersku, name, title,
          short_description, description, brand_name, gender, default_category_id, attributes,
          product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
          product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,
          $19,$20::jsonb,$21,$22,$23,$24,$25, now(), now()
        )
        ON CONFLICT (product_sku) DO NOTHING
        RETURNING id
      `;
            const vals = [
                productId,
                VENDOR_ID,
                productProductId,
                productSku,
                null,
                product.name,
                product.title || null,
                product.short_description || null,
                product.description || null,
                product.brand_name || null,
                product.gender || null,
                defaultCategoryId || null,
                helpers.toJsonb(product.attributes || null),
                helpers.toJsonb(product.product_meta || null),
                product.sizechart_text || null,
                product.sizechart_image || null,
                helpers.toJsonb(product.shipping_returns_payments || null),
                helpers.toJsonb(product.environmental_impact || null),
                product.product_img || null,
                helpers.toJsonb(product.videos || null),
                product.delivery_time || null,
                product.cod_available !== undefined ? product.cod_available : true,
                product.supplier || null,
                product.country_of_origin || null,
                product.is_active !== undefined ? product.is_active : true,
            ];
            const ins = await client.query(insertProductSql, vals);

            if (ins.rowCount === 0) {
                // conflict — select existing (first row wins)
                const sel = await client.query(
                    `SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL LIMIT 1`,
                    [productSku]
                );
                if (sel.rowCount) productId = sel.rows[0].id;
                else throw new Error(`Race on products: could not select by product_sku=${productSku}`);
            } else {
                productId = ins.rows[0].id;
            }
        } else {
            // fallback using supplier_product_id if no sku provided
            let existing = null;
            if (productProductId) {
                const res = await client.query(
                    `SELECT id FROM products WHERE productid = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
                    [productProductId, VENDOR_ID]
                );
                if (res.rowCount) existing = res.rows[0];
            }
            if (existing) {
                productId = existing.id;
                await client.query(
                    `UPDATE products SET
            vendor_id = COALESCE(vendor_id, $1),
            default_category_id = COALESCE(default_category_id, $2),
            updated_at = now()
           WHERE id = $3`,
                    [VENDOR_ID, defaultCategoryId, productId]
                );
            } else {
                const insertProductSql = `
          INSERT INTO products (
            id, vendor_id, productid, product_sku, productpartnersku, name, title,
            short_description, description, brand_name, brand_name_normalized, gender, default_category_id, attributes,
            product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
            product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
            $14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19::jsonb,
            $20,$21::jsonb,$22,$23,$24,$25,$26, now(), now()
          ) RETURNING id
        `;
                const vals = [
                    productId,
                    VENDOR_ID,
                    productProductId,
                    null,
                    null,
                    product.name,
                    product.title || null,
                    product.short_description || null,
                    product.description || null,
                    product.brand_name || null,
                    normalizeBrandName(product.brand_name),
                    product.gender || null,
                    defaultCategoryId || null,
                    helpers.toJsonb(product.attributes || null),
                    helpers.toJsonb(product.product_meta || null),
                    product.sizechart_text || null,
                    product.sizechart_image || null,
                    helpers.toJsonb(product.shipping_returns_payments || null),
                    helpers.toJsonb(product.environmental_impact || null),
                    product.product_img || null,
                    helpers.toJsonb(product.videos || null),
                    product.delivery_time || null,
                    product.cod_available !== undefined ? product.cod_available : true,
                    product.supplier || null,
                    product.country_of_origin || null,
                    product.is_active !== undefined ? product.is_active : true,
                ];
                const ins = await client.query(insertProductSql, vals);
                productId = ins.rows[0].id;
            }
        }

        // VARIANTS — create/update from size_quantity
        const _catHint = categoryHintFromPath(category_path);
        const _genHint = genderHintFromPath(category_path) || product.gender || null;

        const createdVariants = [];
        for (const v of variants) {
            // Decide SKU for variant: if product_sku + size present, make `${product_sku}-${size}`, else use v.sku or fallback
            if (!v.sku) {
                const base = product.product_sku || productProductId || productId;
                v.sku = v.variant_size ? `${base}-${v.variant_size}` : `${base}-${Math.random().toString(36).slice(2, 8)}`;
            }

            const _sz = normalizeSize(v.variant_size, _catHint, _genHint);
            const nsfVal = _sz.canonical || v.variant_size || null;
            const stVal = _sz.sizeType || null;

            const varRes = await client.query(
                'SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL',
                [v.sku, productId]
            );

            if (varRes.rowCount) {
                const vid = varRes.rows[0].id;
                await client.query(
                    `
          UPDATE product_variants SET
            vendor_id=$1,
            vendormrp=$2, vendorsaleprice=$3, price=$4, mrp=$5, stock=$6, weight=$7,
            attributes=$8, images=$9, updated_at=now(),
            variant_color=$10, variant_size=$11, country_of_origin=$12, is_active=$13,
            size_type=$14, normalized_size_final=$15
          WHERE id=$16
          `,
                    [
                        VENDOR_ID,
                        v.vendormrp || null,
                        v.vendorsaleprice || null,
                        v.price || null,
                        v.mrp || null,
                        v.stock || 0,
                        v.weight || null,
                        helpers.toJsonb(v.attributes || null),
                        helpers.toJsonb(v.images || null),
                        v.variant_color || null,
                        v.variant_size || null,
                        v.country_of_origin || null,
                        v.is_active !== undefined ? v.is_active : true,
                        stVal,
                        nsfVal,
                        vid,
                    ]
                );
                createdVariants.push({ id: vid, sku: v.sku, updated: true });
            } else {
                const variantId = randomUUID();
                const variantInsertText = `
          INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            price, mrp, stock, weight, dimension, length, width, height,
            attributes, images, image_urls, video1, video2, vendormrp, vendorsaleprice,
            tax, tax1, tax2, tax3, variant_color, variant_size,
            country_of_origin, is_active, normalized_size, normalized_color,
            size_type, normalized_size_final, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12::jsonb,$13,$14,$15,
            $16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,
            $23::jsonb,$24,$25,$26,$27,$28,
            $29,$30,$31,$32,$33,$34, now(), now()
          ) RETURNING id
        `;

                const variantVals = [
                    variantId, // $1
                    VENDOR_ID, // $2
                    productId, // $3
                    v.sku, // $4
                    v.barcode || null, // $5
                    v.vendor_product_id || null, // $6
                    null, // $7 productpartnersku
                    v.price || null, // $8
                    v.mrp || null, // $9
                    v.stock || 0, // $10
                    v.weight || null, // $11
                    helpers.toJsonb(v.dimension || null), // $12
                    v.length || null, // $13
                    v.width || null, // $14
                    v.height || null, // $15
                    helpers.toJsonb(v.attributes || null), // $16
                    helpers.toJsonb(v.images || null), // $17
                    null, // $18 image_urls
                    v.video1 || null, // $19
                    v.video2 || null, // $20
                    v.vendormrp || null, // $21
                    v.vendorsaleprice || null, // $22
                    helpers.toJsonb(v.tax || null), // $23
                    v.tax1 || null, // $24
                    v.tax2 || null, // $25
                    v.tax3 || null, // $26
                    v.variant_color || null, // $27
                    v.variant_size || null, // $28
                    v.country_of_origin || null, // $29
                    v.is_active !== undefined ? v.is_active : true, // $30
                    v.normalized_size || null, // $31
                    v.normalized_color || null, // $32
                    stVal, // $33
                    nsfVal, // $34
                ];

                if (variantVals.length !== 34) {
                    throw new Error(`variantVals length mismatch: ${variantVals.length}`);
                }

                const inVar = await client.query(variantInsertText, variantVals);
                createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

                if (v.stock && Number(v.stock) > 0) {
                    await client.query(
                        `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
             VALUES ($1,$2,$3,$4,$5, now())`,
                        [randomUUID(), inVar.rows[0].id, v.stock, 'initial_import', null]
                    );
                }
            }
        }

        // LINK PRODUCT TO CATEGORY
        if (defaultCategoryId) {
            const exists = await client.query(
                'SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL',
                [productId, defaultCategoryId]
            );
            if (exists.rowCount === 0) {
                await client.query(
                    'INSERT INTO product_categories (id, product_id, category_id,vendor_id) VALUES ($1,$2,$3,$4)',
                    [randomUUID(), productId, defaultCategoryId, VENDOR_ID]
                );
            }
        }

        // DYNAMIC FILTERS — brand/color/size
        const dyns = [];
        if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });
        // we can also push gender & season as filters if you want; for now, mirror previous behavior
        const firstVar = variants[0] || {};
        if (firstVar.variant_color) dyns.push({ filter_type: 'color', filter_name: firstVar.variant_color });
        if (firstVar.variant_size) dyns.push({ filter_type: 'size', filter_name: firstVar.variant_size });

        for (const df of dyns) {
            const ex = await client.query(
                'SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL',
                [productId, df.filter_type, df.filter_name]
            );
            if (ex.rowCount === 0) {
                await client.query(
                    'INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name,vendor_id) VALUES ($1,$2,$3,$4,$5)',
                    [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]
                );
            }
        }

        // MEDIA — product images + variant images (if any)
        const skuToVariantId = new Map();
        const createdVariantsMap = variants || [];
        // sync ids:
        const existingVars = await client.query(
            'SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL',
            [productId]
        );
        for (const row of existingVars.rows) skuToVariantId.set(row.sku, row.id);

        async function upsertMediaRow({ url, variant_id = null, type = 'image', name = null, metadata = {} }) {
            const { rows: exist } = await client.query(
                `SELECT id FROM media WHERE url = $1 AND (variant_id IS NOT DISTINCT FROM $2) AND deleted_at IS NULL LIMIT 1`,
                [url, variant_id]
            );
            if (exist.length > 0) return exist[0].id;
            const mediaId = randomUUID();
            await client.query(
                `INSERT INTO media (id, name, variant_id, url, type, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
                [mediaId, name, variant_id, url, type, helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))]
            );
            return mediaId;
        }

        // product-level images array from transformed.product.images (if set)
        const productImages = Array.isArray(product.images) ? product.images : [];
        for (const url of productImages) {
            if (!url) continue;
            const { rows: already } = await client.query(
                'SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1',
                [url]
            );
            if (already.length > 0) continue;
            try {
                await upsertMediaRow({ url, variant_id: null, type: 'image', metadata: {} });
            } catch (e) {
                console.error('media insert error (product)', e.message || e);
            }
        }

        // variant-level (if you later map images per variant)
        for (const v of variants) {
            const vid = skuToVariantId.get(v.sku) || null;
            const imageUrls = Array.isArray(v.images) ? v.images : [];
            for (const url of imageUrls) {
                if (!url) continue;
                try {
                    await upsertMediaRow({ url, variant_id: vid, type: 'image', metadata: { variant_sku: v.sku } });
                } catch (e) {
                    console.error('media insert error (variant)', e.message || e);
                }
            }
        }

        await client.query('COMMIT');
        return { ok: true, productId, variants: createdVariants };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
}

// ---------- PROCESSORS ----------
async function processRow(row, lineNumber) {
    const transformed = helpers.transformRowToProduct(row);
    if (!transformed) {
        return { ok: true, skipped: true };
    }
    if (isBrandExcluded(transformed?.product?.brand_name)) {
        return { ok: true, skipped: true };
    }
    const client = await pool.connect();
    try {
        const res = await upsertProductAndVariant(client, transformed);
        logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'ld-imported');
        return { ok: true, productId: res.productId };
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

async function processCSVBuffer(buffer, opts = {}) {
    const { concurrency, errFileDir } = Object.assign({}, DEFAULTS, opts);
    const Queue = await getPQueue();
    const queue = new Queue({ concurrency });

    const ERR_FILE = path.join(errFileDir, `ld_import_errors_${Date.now()}.jsonl`);
    fs.writeFileSync(ERR_FILE, '');

    let lineNumber = 0;
    let processedCount = 0;
    let errorCount = 0;

    const readable = new Readable();
    readable._read = () => { };
    readable.push(buffer);
    readable.push(null);

    const csvStream = csv
        .parse({ headers: true, ignoreEmpty: true, trim: true })
        .on('error', (err) => {
            logger.error({ err }, 'csv parse error');
            throw err;
        })
        .on('data', (row) => {
            lineNumber++;
            queue.add(async () => {
                try {
                    await processRow(row, lineNumber);
                    processedCount++;
                } catch (err) {
                    errorCount++;
                    const errLine = { line: lineNumber, error: err.message, row };
                    fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
                    logger.error({ line: lineNumber, err: err.message }, 'ld-import error');
                }
            });
        })
        .on('end', async (rowCount) => {
            logger.info({ rowCount }, 'ld csv read finished; waiting for queue');
        });

    readable.pipe(csvStream);
    await queue.onIdle();

    return { processedCount, errorCount, errorsPath: ERR_FILE };
}

module.exports = {
    processCSVBuffer,
    ensureCategoryPath,
    upsertProductAndVariant,
};
