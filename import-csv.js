// import_products.js
const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');
const PQueue = require('p-queue').default;
const pino = require('pino');
const { Pool } = require('pg');
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const helpers = require('./importHelpers');

const logger = pino({ level: 'info' });
console.log('🔌 Setting up database connection pool...', process.env.DATABASE_URL);
// DB pool - set PG connection via env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20
});

// configure
const CSV_FILE = process.argv[2] || './product_csv.csv';
const CONCURRENCY = parseInt(process.env.IMPORT_CONCURRENCY || '4', 10);
const BATCH_SIZE = parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10); // not used directly - we process per-row but with concurrency

// path to error log
const ERR_FILE = path.join(process.cwd(), 'import_errors.jsonl');

const queue = new PQueue({ concurrency: CONCURRENCY });
// async function ensureCategoryPath(client, categoryPath) {
//     if (!categoryPath) return null;

//     // Normalize incoming path into segments
//     const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
//     if (!parts || parts.length === 0) return null;

//     let parentId = null;
//     let parentPath = null;

//     for (const part of parts) {
//         const slug = helpers.slugify(part);
//         const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

//         // Try exact path first (most reliable)
//         const found = await client.query(
//             `SELECT id FROM categories WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
//             [currentPath]
//         );

//         if (found.rowCount > 0) {
//             parentId = found.rows[0].id;
//             parentPath = currentPath;
//             continue;
//         }

//         // Not found -> insert new category with parentId (may be null for root)
//         const id = uuidv4();
//         const metadata = { created_via_import: true };

//         const insertSql = `
//       INSERT INTO categories (id, name, slug, parent_id, path, is_active, metadata, created_at)
//       VALUES ($1,$2,$3,$4,$5,true,$6, now())
//       RETURNING id
//     `;
//         const insertParams = [id, part, slug, parentId, currentPath, JSON.stringify(metadata)];
//         const ins = await client.query(insertSql, insertParams);

//         parentId = ins.rows[0].id;
//         parentPath = currentPath;
//     }

//     return parentId;
// }

async function ensureCategoryPath(client, categoryPath) {
    if (!categoryPath) return null;

    const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;

    let parentId = null;
    let parentPath = null;

    for (const part of parts) {
        const baseSlug = helpers.slugify(part);
        let attempt = 0;
        let slugCandidate = baseSlug;
        let createdOrFoundId = null;

        // try until we succeed (slugCandidate collisions resolved by suffix)
        while (true) {
            // build the candidate path (this is what we enforce uniquely)
            const candidatePath = parentPath ? `${parentPath}/${slugCandidate}` : slugCandidate;

            // Try atomic insert that returns id whether inserted or existed.
            // ON CONFLICT (path) DO UPDATE ensures we always get a row (and returns id).
            const id = uuidv4();
            const metadata = { created_via_import: true };

            try {
                const insertSql = `
          INSERT INTO categories (id, name, slug, parent_id, path, is_active, metadata, created_at)
          VALUES ($1,$2,$3,$4,$5,true,$6, now())
          ON CONFLICT (path)
          DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `;
                const params = [id, part, slugCandidate, parentId, candidatePath, JSON.stringify(metadata)];
                const res = await client.query(insertSql, params);

                if (res.rowCount > 0) {
                    createdOrFoundId = res.rows[0].id;
                    console.log(`[ensureCategoryPath] got id=${createdOrFoundId} path=${candidatePath} slug=${slugCandidate} parentId=${parentId}`);
                    break;
                }
            } catch (err) {
                // If slug is unique per parent (parent_id,slug index) and slugCandidate conflicts,
                // Postgres will raise unique_violation 23505. Detect and retry with suffix.
                if (err && err.code === '23505') {
                    // inspect message to detect whether conflict came from parent+slug index or other
                    const detail = err.detail || err.message || '';
                    if (/categories_parent_slug_unique_idx/.test(detail) || /parent_id.*slug/i.test(detail) || /categories_slug_key/.test(detail)) {
                        attempt += 1;
                        slugCandidate = `${baseSlug}-${attempt}`;
                        // small backoff to reduce thrash (optional)
                        // await new Promise(r => setTimeout(r, 5));
                        console.log(`[ensureCategoryPath] slug collision for '${baseSlug}', trying '${slugCandidate}'`);
                        continue; // retry with new slugCandidate
                    }
                }
                // unknown error -> rethrow
                throw err;
            }
        } // end while

        // set as parent for next level
        parentId = createdOrFoundId;
        // fetch canonical path from DB so parentPath is always DB-canonical
        const p = await client.query('SELECT path FROM categories WHERE id = $1 LIMIT 1', [parentId]);
        parentPath = p.rows[0].path;
    } // end for parts

    return parentId;
}

// -----------------------------
// Upsert product + variants + categories + dynamic filters + media
// -----------------------------
async function upsertProductAndVariant(client, transformed) {
    // transformed: { product, variants, category_path }
    await client.query('BEGIN');
    try {
        const { product, variants = [], category_path } = transformed;

        // 1) ensure category path -> returns category id (leaf)
        let defaultCategoryId = null;
        if (category_path) {
            defaultCategoryId = await ensureCategoryPath(client, category_path);
        }

        // 2) check idempotency: existing product by productid OR product_sku
        let existing = null;
        if (product.productid) {
            const res = await client.query('SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL', [product.productid]);
            if (res.rowCount) existing = res.rows[0];
        }
        if (!existing && product.product_sku) {
            const res2 = await client.query('SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL', [product.product_sku]);
            if (res2.rowCount) existing = res2.rows[0];
        }

        // 3) Upsert product (simple fields)
        let productId = existing ? existing.id : uuidv4();
        if (existing) {
            await client.query(
                `UPDATE products SET
           name=$1, title=$2, short_description=$3, description=$4, brand_name=$5,
           product_img=$6, product_img1=$7, product_img2=$8, product_img3=$9, product_img4=$10, product_img5=$11,
           default_category_id=$12, updated_at=now()
         WHERE id=$13`,
                [
                    product.name, product.title, product.short_description, product.description, product.brand_name,
                    product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5,
                    defaultCategoryId, productId
                ]
            );
        } else {
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
        ) RETURNING id
      `;
            const vals = [
                productId,
                null,
                product.productid || null,
                product.product_sku || null,
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
                product.is_active !== undefined ? product.is_active : true
            ];
            const ins = await client.query(insertProductSql, vals);
            productId = ins.rows[0].id;
        }

        // 4) Variants: upsert by sku
        const createdVariants = []; // will hold { id, sku, created?, updated? }
        for (const v of variants) {
            if (!v.sku) {
                v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
            }

            // check existing variant by sku for this product
            const varRes = await client.query('SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL', [v.sku, productId]);
            if (varRes.rowCount) {
                const vid = varRes.rows[0].id;
                await client.query(
                    `UPDATE product_variants SET
             price=$1, mrp=$2, sale_price=$3, stock=$4, weight=$5,
             attributes=$6, images=$7, updated_at=now()
           WHERE id=$8`,
                    [v.price || null, v.mrp || null, v.sale_price || null, v.stock || 0, v.weight || null, helpers.toJsonb(v.attributes || null), helpers.toJsonb(v.images || null), vid]
                );
                createdVariants.push({ id: vid, sku: v.sku, updated: true });
            } else {
                const variantId = uuidv4();
                const variantInsertText = `
          INSERT INTO product_variants (
            id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            price, mrp, sale_price, stock, weight, dimension, length, width, height,
            attributes, images, image_urls, video1, video2, vendormrp, vendorsaleprice,
            ourmrp, oursaleprice, tax, tax1, tax2, tax3, variant_color, variant_size,
            country_of_origin, is_active, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,
            $16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,
            $23,$24,$25::jsonb,$26,$27,$28,$29,$30,$31,$32, now(), now()
          ) RETURNING id
        `;
                const variantVals = [
                    variantId,
                    productId,
                    v.sku,
                    v.barcode || null,
                    v.vendor_product_id || null,
                    null,
                    v.price || null,
                    v.mrp || null,
                    v.sale_price || null,
                    v.stock || 0,
                    v.weight || null,
                    helpers.toJsonb(v.dimension || null),
                    v.length || null,
                    v.width || null,
                    v.height || null,
                    helpers.toJsonb(v.attributes || null),
                    helpers.toJsonb(v.images || null),
                    null, // image_urls
                    v.video1 || null,
                    v.video2 || null,
                    v.vendormrp || null,
                    v.vendorsaleprice || null,
                    v.ourmrp || null,
                    v.oursaleprice || null,
                    helpers.toJsonb(v.tax || null),
                    v.tax1 || null,
                    v.tax2 || null,
                    v.tax3 || null,
                    v.variant_color || null,
                    v.variant_size || null,
                    v.country_of_origin || null,
                    v.is_active !== undefined ? v.is_active : true
                ];

                if (variantVals.length !== 32) {
                    throw new Error(`variantVals length mismatch: ${variantVals.length}`);
                }

                const inVar = await client.query(variantInsertText, variantVals);
                createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

                if (v.stock && Number(v.stock) > 0) {
                    await client.query(
                        `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at) VALUES ($1,$2,$3,$4,$5, now())`,
                        [uuidv4(), inVar.rows[0].id, v.stock, 'initial_import', null]
                    );
                }
            }
        } // end variants loop

        // 5) Ensure product_categories mapping exists for defaultCategoryId
        if (defaultCategoryId) {
            const exists = await client.query('SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL', [productId, defaultCategoryId]);
            if (exists.rowCount === 0) {
                await client.query('INSERT INTO product_categories (id, product_id, category_id) VALUES ($1,$2,$3)', [uuidv4(), productId, defaultCategoryId]);
            }
        }

        // 6) Create dynamic filters (brand/color/size) - idempotent
        const dyns = [];
        if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });
        const firstVar = variants[0] || {};
        if (firstVar.variant_color) dyns.push({ filter_type: 'color', filter_name: firstVar.variant_color });
        if (firstVar.variant_size) dyns.push({ filter_type: 'size', filter_name: firstVar.variant_size });

        for (const df of dyns) {
            const ex = await client.query('SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL', [productId, df.filter_type, df.filter_name]);
            if (ex.rowCount === 0) {
                await client.query('INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name) VALUES ($1,$2,$3,$4)', [uuidv4(), productId, df.filter_type, df.filter_name]);
            }
        }

        // 7) MEDIA handling: attach images to variant if possible, else product-level.
        // Build sku->variantId map from createdVariants and DB fallback
        const skuToVariantId = new Map();
        for (const cv of createdVariants) {
            if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
        }
        // fetch any remaining variants for this product (safety)
        const existingVars = await client.query('SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL', [productId]);
        for (const row of existingVars.rows) {
            if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);
        }

        // helper to insert if not exists (url, variant_id)
        async function upsertMediaRow({ url, variant_id = null, type = 'image', name = null, metadata = {} }) {
            const { rows: exist } = await client.query(
                `SELECT id FROM media WHERE url = $1 AND (variant_id IS NOT DISTINCT FROM $2) AND deleted_at IS NULL LIMIT 1`,
                [url, variant_id]
            );
            if (exist.length > 0) return exist[0].id;
            const mediaId = uuidv4();
            await client.query(
                `INSERT INTO media (id, name, variant_id, url, type, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6, now())`,
                [mediaId, name, variant_id, url, type, helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))]
            );
            return mediaId;
        }

        // 7a: attach variant images
        for (const v of variants) {
            const imageUrls = Array.isArray(v.images) ? v.images : (v.images ? (typeof v.images === 'string' ? [v.images] : []) : []);
            if (!imageUrls || imageUrls.length === 0) continue;
            const vid = skuToVariantId.get(v.sku) || null;
            for (const url of imageUrls) {
                if (!url) continue;
                try {
                    await upsertMediaRow({ url, variant_id: vid, type: 'image', metadata: { variant_sku: v.sku } });
                } catch (e) {
                    console.error('media insert error (variant)', e.message || e);
                }
            }
        }

        // 7b: product-level images - only insert URLs that are not already present at any variant/product
        const productImageUrls = [product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5].filter(Boolean);
        for (const url of productImageUrls) {
            if (!url) continue;
            // skip if any media row with this url exists
            const { rows: already } = await client.query('SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1', [url]);
            if (already.length > 0) continue;
            try {
                await upsertMediaRow({ url, variant_id: null, type: 'image', metadata: {} });
            } catch (e) {
                console.error('media insert error (product)', e.message || e);
            }
        }

        await client.query('COMMIT');
        return { ok: true, productId, variants: createdVariants };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
}


async function processRow(row, lineNumber) {
    const transformed = helpers.transformRowToProduct(row);
    const client = await pool.connect();
    try {
        const res = await upsertProductAndVariant(client, transformed);
        logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'imported');
    } catch (err) {
        // log error to file (json lines)
        const errLine = { line: lineNumber, error: err.message, row };
        fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
        logger.error({ line: lineNumber, err: err.message }, 'import error');
    } finally {
        client.release();
    }
}

(async function main() {
    logger.info({ file: CSV_FILE, concurrency: CONCURRENCY }, 'starting import');
    // ensure error file exists
    fs.writeFileSync(ERR_FILE, '');

    let lineNumber = 0;
    // stream parse CSV
    const stream = fs.createReadStream(CSV_FILE);
    const csvStream = csv.parse({ headers: true, ignoreEmpty: true, trim: true })
        .on('error', err => {
            logger.error({ err }, 'csv error');
            process.exit(1);
        })
        .on('data', row => {
            lineNumber++;
            // enqueue processing
            queue.add(() => processRow(row, lineNumber));
            // optionally throttle by queue size
            if (queue.size > 1000) {
                // this is to avoid OOM in extreme cases
                csvStream.pause();
                (async function waitQueue() {
                    await queue.onIdle();
                    csvStream.resume();
                })();
            }
        })
        .on('end', async rowCount => {
            logger.info({ rowCount }, 'csv read finished; waiting for queue');
            await queue.onIdle();
            logger.info('import completed');
            await pool.end();
        });

    stream.pipe(csvStream);
})();
