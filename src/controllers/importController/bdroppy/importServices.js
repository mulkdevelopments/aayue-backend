// // controllers/importController/bdroppy/services/importService.js
// const fs = require('fs');
// const path = require('path');
// const csv = require('fast-csv');
// const PQueue = require('p-queue').default;
// const pino = require('pino');
// const { Pool } = require('pg');
// const { randomUUID } = require("crypto");
// const { Readable } = require('stream');
// require('dotenv').config();

// const helpers = require('./importHelper');

// const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });

// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10)
// });

// const DEFAULTS = {
//     concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
//     errFileDir: process.cwd(),
//     batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10)
// };

// // ====== VENDOR ID you requested be added ======
// const VENDOR_ID = 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0';

// // ensureCategoryPath now writes vendor_id (and keeps previous behavior)
// async function ensureCategoryPath(client, categoryPath) {
//     if (!categoryPath) return null;
//     const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
//     if (!parts || parts.length === 0) return null;

//     let parentId = null;
//     let parentPath = null;

//     for (const part of parts) {
//         const slug = helpers.slugify(part);
//         const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

//         const found = await client.query(`SELECT id FROM categories WHERE path = $1 AND deleted_at IS NULL LIMIT 1`, [currentPath]);
//         if (found.rowCount > 0) {
//             parentId = found.rows[0].id;
//             parentPath = currentPath;
//             continue;
//         }

//         const id = randomUUID();
//         const metadata = { created_via_import: true };
//         // note: categories table must have vendor_id column (make sure migration adds it)
//         const insertSql = `
//       INSERT INTO categories (id, name, slug, parent_id, path, vendor_id, is_active, metadata, created_at)
//       VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
//       RETURNING id
//     `;
//         const insertParams = [id, part, slug, parentId, currentPath, VENDOR_ID, JSON.stringify(metadata)];
//         const ins = await client.query(insertSql, insertParams);
//         parentId = ins.rows[0].id;
//         parentPath = currentPath;
//     }

//     return parentId;
// }

// async function upsertProductAndVariant(client, transformed) {
//     await client.query('BEGIN');
//     try {
//         const { product, variants = [], category_path } = transformed;

//         let defaultCategoryId = null;
//         if (category_path) {
//             defaultCategoryId = await ensureCategoryPath(client, category_path);
//         }

//         let existing = null;
//         if (product.productid) {
//             const res = await client.query('SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL', [product.productid]);
//             if (res.rowCount) existing = res.rows[0];
//         }
//         if (!existing && product.product_sku) {
//             const res2 = await client.query('SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL', [product.product_sku]);
//             if (res2.rowCount) existing = res2.rows[0];
//         }

//         let productId = existing ? existing.id : randomUUID();
//         if (existing) {
//             await client.query(
//                 `UPDATE products SET
//            name=$1, title=$2, short_description=$3, description=$4, brand_name=$5,
//            product_img=$6, product_img1=$7, product_img2=$8, product_img3=$9, product_img4=$10, product_img5=$11,
//            default_category_id=$12, updated_at=now()
//          WHERE id=$13`,
//                 [
//                     product.name, product.title, product.short_description, product.description, product.brand_name,
//                     product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5,
//                     defaultCategoryId, productId
//                 ]
//             );
//         } else {
//             const insertProductSql = `
//         INSERT INTO products (
//           id, vendor_id, productid, product_sku, productpartnersku, name, title,
//           short_description, description, brand_name, gender, default_category_id, attributes,
//           product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
//           product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
//         ) VALUES (
//           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
//           $13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,
//           $19,$20::jsonb,$21,$22,$23,$24,$25, now(), now()
//         ) RETURNING id
//       `;
//             const vals = [
//                 productId,
//                 VENDOR_ID, // <-- write vendor_id here
//                 product.productid || null,
//                 product.product_sku || null,
//                 null,
//                 product.name,
//                 product.title || null,
//                 product.short_description || null,
//                 product.description || null,
//                 product.brand_name || null,
//                 product.gender || null,
//                 defaultCategoryId || null,
//                 helpers.toJsonb(product.attributes || null),
//                 helpers.toJsonb(product.product_meta || null),
//                 product.sizechart_text || null,
//                 product.sizechart_image || null,
//                 helpers.toJsonb(product.shipping_returns_payments || null),
//                 helpers.toJsonb(product.environmental_impact || null),
//                 product.product_img || null,
//                 helpers.toJsonb(product.videos || null),
//                 product.delivery_time || null,
//                 product.cod_available !== undefined ? product.cod_available : true,
//                 product.supplier || null,
//                 product.country_of_origin || null,
//                 product.is_active !== undefined ? product.is_active : true
//             ];
//             const ins = await client.query(insertProductSql, vals);
//             productId = ins.rows[0].id;
//         }

//         const createdVariants = [];
//         console.log(variants, "variants")
//         for (const v of variants) {
//             if (!v.sku) {
//                 v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
//             }

//             const varRes = await client.query('SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL', [v.sku, productId]);
//             if (varRes.rowCount) {
//                 const vid = varRes.rows[0].id;
//                 await client.query(
//                     `UPDATE product_variants SET
//              price=$1, mrp=$2, sale_price=$3, stock=$4, weight=$5,
//              attributes=$6, images=$7, updated_at=now()
//            WHERE id=$8`,
//                     [v.price || null, v.mrp || null, v.sale_price || null, v.stock || 0, v.weight || null, helpers.toJsonb(v.attributes || null), helpers.toJsonb(v.images || null), vid]
//                 );
//                 createdVariants.push({ id: vid, sku: v.sku, updated: true });
//             } else {
//                 const variantId = randomUUID();
//                 const variantInsertText = `
//             INSERT INTO product_variants (
//                 id, product_id, sku, barcode, vendor_product_id, productpartnersku,
//                 price, mrp, sale_price, stock, weight, dimension, length, width, height,
//                 attributes, images, image_urls, video1, video2, vendormrp, vendorsaleprice,
//                 ourmrp, oursaleprice, tax, tax1, tax2, tax3, variant_color, variant_size,
//                 country_of_origin, is_active, normalized_size, normalized_color,vendor_id, created_at, updated_at
//             ) VALUES (
//                 $1,$2,$3,$4,$5,$6,
//                 $7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,
//                 $16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,
//                 $23,$24,$25::jsonb,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35, now(), now()
//             ) RETURNING id
//         `;
//                 const variantVals = [
//                     variantId,
//                     productId,
//                     v.sku,
//                     v.barcode || null,
//                     v.vendor_product_id || null,
//                     null,
//                     v.price || null,
//                     v.mrp || null,
//                     v.sale_price || null,
//                     v.stock || 0,
//                     v.weight || null,
//                     helpers.toJsonb(v.dimension || null),
//                     v.length || null,
//                     v.width || null,
//                     v.height || null,
//                     helpers.toJsonb(v.attributes || null),
//                     helpers.toJsonb(v.images || null),
//                     null,
//                     v.video1 || null,
//                     v.video2 || null,
//                     v.vendormrp || null,
//                     v.vendorsaleprice || null,
//                     v.ourmrp || null,
//                     v.oursaleprice || null,
//                     helpers.toJsonb(v.tax || null),
//                     v.tax1 || null,
//                     v.tax2 || null,
//                     v.tax3 || null,
//                     v.variant_color || null,
//                     v.variant_size || null,
//                     v.country_of_origin || null,
//                     v.is_active !== undefined ? v.is_active : true,
//                     v?.normalized_size || v.variant_size || null,
//                     v?.normalized_color || null,
//                     VENDOR_ID || null
//                 ];

//                 if (variantVals.length !== 35) {
//                     throw new Error(`variantVals length mismatch: ${variantVals.length}`);
//                 }

//                 const inVar = await client.query(variantInsertText, variantVals);
//                 createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

//                 if (v.stock && Number(v.stock) > 0) {
//                     await client.query(
//                         `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at) VALUES ($1,$2,$3,$4,$5, now())`,
//                         [randomUUID(), inVar.rows[0].id, v.stock, 'initial_import', null]
//                     );
//                 }
//             }
//         } // end variants loop

//         if (defaultCategoryId) {
//             const exists = await client.query('SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL', [productId, defaultCategoryId]);
//             if (exists.rowCount === 0) {
//                 await client.query('INSERT INTO product_categories (id, product_id, category_id,vendor_id) VALUES ($1,$2,$3,$4)', [randomUUID(), productId, defaultCategoryId, VENDOR_ID]);
//             }
//         }

//         const dyns = [];
//         if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });
//         const firstVar = variants[0] || {};
//         if (firstVar.variant_color) dyns.push({ filter_type: 'color', filter_name: firstVar.variant_color });
//         if (firstVar.variant_size) dyns.push({ filter_type: 'size', filter_name: firstVar.variant_size });

//         for (const df of dyns) {
//             const ex = await client.query('SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL', [productId, df.filter_type, df.filter_name]);
//             if (ex.rowCount === 0) {
//                 await client.query('INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name,vendor_id) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]);
//             }
//         }

//         // MEDIA handling (same as your script)
//         const skuToVariantId = new Map();
//         const createdVariantsMap = createdVariants || [];
//         for (const cv of createdVariantsMap) {
//             if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
//         }
//         const existingVars = await client.query('SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL', [productId]);
//         for (const row of existingVars.rows) {
//             if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);
//         }

//         async function upsertMediaRow({ url, variant_id = null, type = 'image', name = null, metadata = {} }) {
//             const { rows: exist } = await client.query(
//                 `SELECT id FROM media WHERE url = $1 AND (variant_id IS NOT DISTINCT FROM $2) AND deleted_at IS NULL LIMIT 1`,
//                 [url, variant_id]
//             );
//             if (exist.length > 0) return exist[0].id;
//             const mediaId = randomUUID();
//             await client.query(
//                 `INSERT INTO media (id, name, variant_id, url, type, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6, now())`,
//                 [mediaId, name, variant_id, url, type, helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))]
//             );
//             return mediaId;
//         }

//         for (const v of variants) {
//             const imageUrls = Array.isArray(v.images) ? v.images : (v.images ? (typeof v.images === 'string' ? [v.images] : []) : []);
//             if (!imageUrls || imageUrls.length === 0) continue;
//             const vid = skuToVariantId.get(v.sku) || null;
//             for (const url of imageUrls) {
//                 if (!url) continue;
//                 try {
//                     await upsertMediaRow({ url, variant_id: vid, type: 'image', metadata: { variant_sku: v.sku } });
//                 } catch (e) {
//                     console.error('media insert error (variant)', e.message || e);
//                 }
//             }
//         }

//         const productImageUrls = [product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5].filter(Boolean);
//         for (const url of productImageUrls) {
//             if (!url) continue;
//             const { rows: already } = await client.query('SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1', [url]);
//             if (already.length > 0) continue;
//             try {
//                 await upsertMediaRow({ url, variant_id: null, type: 'image', metadata: {} });
//             } catch (e) {
//                 console.error('media insert error (product)', e.message || e);
//             }
//         }

//         await client.query('COMMIT');
//         return { ok: true, productId, variants: createdVariants };
//     } catch (err) {
//         await client.query('ROLLBACK').catch(() => { });
//         throw err;
//     }
// }

// // Process single row; for backward-compatible flow (not used by grouped flow)
// async function processRow(row, lineNumber) {
//     const transformed = helpers.transformRowToProduct(row);

//     const client = await pool.connect();
//     try {
//         const res = await upsertProductAndVariant(client, transformed);
//         logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'imported');
//         return { ok: true, productId: res.productId };
//     } catch (err) {
//         throw err;
//     } finally {
//         client.release();
//     }
// }

// /**
//  * Process CSV buffer (uploaded file) for new format where PRODUCT row is followed by MODEL rows.
//  * Groups rows by product_id and processes each product once.
//  *
//  * Returns summary:
//  * { processedCount, errorCount, errorsPath }
//  */
// async function processCSVBuffer(buffer, opts = {}) {
//     const { concurrency, errFileDir } = Object.assign({}, DEFAULTS, opts);
//     const queue = new PQueue({ concurrency });

//     // make an error file unique to this run
//     const ERR_FILE = path.join(errFileDir, `import_errors_${Date.now()}.jsonl`);
//     fs.writeFileSync(ERR_FILE, '');

//     // We'll accumulate rows then group by product_id
//     const allRows = [];
//     const csvStream = csv.parse({ headers: true, ignoreEmpty: true, trim: false })
//         .on('error', err => {
//             logger.error({ err }, 'csv parse error');
//             throw err; // bubble up
//         })
//         .on('data', row => {
//             // normalize keys by trimming header names (sometimes headers have trailing spaces)
//             const normalized = {};
//             for (const k of Object.keys(row)) {
//                 const nk = String(k).trim();
//                 normalized[nk] = row[k];
//             }
//             allRows.push(normalized);
//         })
//         .on('end', async rowCount => {
//             logger.info({ rowCount }, 'csv read finished; grouping rows by product_id');
//         });

//     // pipe from buffer
//     const readable = new Readable();
//     readable._read = () => { };
//     readable.push(buffer);
//     readable.push(null);
//     readable.pipe(csvStream);

//     // wait for parse to finish
//     await new Promise((resolve, reject) => {
//         csvStream.on('end', resolve);
//         csvStream.on('error', reject);
//     });

//     // group rows by product_id
//     const groups = new Map();
//     for (const r of allRows) {
//         const pid = String(r['product_id'] || '').trim() || '__no_id__';
//         if (!groups.has(pid)) groups.set(pid, []);
//         groups.get(pid).push(r);
//     }

//     let processedCount = 0;
//     let errorCount = 0;

//     // for each group, find the PRODUCT row (if any) and the MODEL rows
//     for (const [pid, rows] of groups.entries()) {
//         queue.add(async () => {
//             const productRow = rows.find(rr => String(rr['record_type'] || '').toUpperCase() === 'PRODUCT') || rows.find(rr => rr['code'] || rr['name']);
//             const modelRows = rows.filter(rr => String(rr['record_type'] || '').toUpperCase() === 'MODEL');

//             try {
//                 const transformed = helpers.transformGroupedRows(productRow || {}, modelRows || []);
//                 const client = await pool.connect();
//                 try {
//                     const res = await upsertProductAndVariant(client, transformed);
//                     logger.info({ product_id: pid, productId: res.productId }, 'imported product group');
//                     processedCount++;
//                 } finally {
//                     client.release();
//                 }
//             } catch (err) {
//                 errorCount++;
//                 const errLine = { product_id: pid, error: err.message, rows: rows.slice(0, 3) }; // sample rows for debugging
//                 fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
//                 logger.error({ product_id: pid, err: err.message }, 'import group error');
//             }
//         }).catch(e => {
//             // log queue scheduling errors
//             logger.error({ err: e.message || e }, 'queue add failed');
//         });
//     }

//     // wait for queue
//     await queue.onIdle();

//     return { processedCount, errorCount, errorsPath: ERR_FILE };
// }

// module.exports = {
//     processCSVBuffer,
//     ensureCategoryPath,
//     upsertProductAndVariant
// };


// controllers/importController/bdroppy/services/importService.js
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

const helpers = require('./importHelper');
const { normalizeBrandName } = require("../../../utils/normalize");
const { isBrandExcluded } = require("../excludedBrands");

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10)
});

const DEFAULTS = {
    concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
    errFileDir: process.cwd(),
    batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10)
};

// ====== VENDOR ID (BDroppy) ======
const VENDOR_ID = 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0';

/* ---------------------
   Price conversion helpers
   --------------------- */
function convertToAED(value, conversionRate, incrementPercent) {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const baseAED = num * Number(conversionRate);
    const inc = (baseAED * Number(incrementPercent)) / 100;
    return Number((baseAED + inc).toFixed(2));
}

function convertToAEDWithoutIncrement(value, conversionRate) {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const baseAED = num * Number(conversionRate);
    return Number(baseAED.toFixed(2));
}

/* ---------------------
   Category ensure (writes vendor_id)
   --------------------- */
async function ensureCategoryPath(client, categoryPath) {
    if (!categoryPath) return null;
    const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;

    let parentId = null;
    let parentPath = null;

    for (const part of parts) {
        const slug = helpers.slugify(part);
        const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

        const found = await client.query(
            `SELECT id FROM categories WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
            [currentPath]
        );
        if (found.rowCount > 0) {
            parentId = found.rows[0].id;
            parentPath = currentPath;
            continue;
        }

        const id = randomUUID();
        const metadata = { created_via_import: true };
        const insertSql = `
      INSERT INTO categories (id, name, slug, parent_id, path, vendor_id, is_active, metadata, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
      RETURNING id
    `;
        const insertParams = [id, part, slug, parentId, currentPath, VENDOR_ID, JSON.stringify(metadata)];
        const ins = await client.query(insertSql, insertParams);
        parentId = ins.rows[0].id;
        parentPath = currentPath;
    }

    return parentId;
}

/* ---------------------
   Upsert product + variants (main logic)
   - transformed must be { product, variants, category_path } (from helpers.transformGroupedRows)
   - opts: { currency, conversion_rate, increment_percent, concurrency? }
   --------------------- */
async function upsertProductAndVariant(client, transformed, opts = {}) {
    await client.query('BEGIN');
    try {
        const { product, variants = [], category_path } = transformed;

        let defaultCategoryId = null;
        if (category_path) defaultCategoryId = await ensureCategoryPath(client, category_path);

        // find existing product by productid or sku
        let existing = null;
        if (product.productid) {
            const res = await client.query('SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL', [product.productid]);
            if (res.rowCount) existing = res.rows[0];
        }
        if (!existing && product.product_sku) {
            const res2 = await client.query('SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL', [product.product_sku]);
            if (res2.rowCount) existing = res2.rows[0];
        }

        let productId = existing ? existing.id : randomUUID();

        if (existing) {
            // update limited fields (keep original logic)
            await client.query(
                `UPDATE products SET
           name=$1, title=$2, short_description=$3, description=$4, brand_name=$5, brand_name_normalized=$6,
           product_img=$7, product_img1=$8, product_img2=$9, product_img3=$10, product_img4=$11, product_img5=$12,
           default_category_id=$13, updated_at=now()
         WHERE id=$14`,
                [
                    product.name, product.title, product.short_description, product.description, product.brand_name,
                    normalizeBrandName(product.brand_name),
                    product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5,
                    defaultCategoryId, productId
                ]
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
                product.productid || null,
                product.product_sku || null,
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
                product.is_active !== undefined ? product.is_active : true
            ];
            const ins = await client.query(insertProductSql, vals);
            productId = ins.rows[0].id;
        }

        // Process variants
        const createdVariants = [];
        for (const v of variants) {
            if (!v.sku) {
                v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
            }

            // raw vendor fields (prefer explicit vendormrp/vendorsaleprice)
            const rawVendorMrp = (typeof v.vendormrp !== 'undefined' && v.vendormrp !== null) ? v.vendormrp : v.mrp;
            const rawVendorSale = (typeof v.vendorsaleprice !== 'undefined' && v.vendorsaleprice !== null) ? v.vendorsaleprice : v.sale_price;

            // converted with increment (to write into mrp / sale_price)
            const convertedMrp = convertToAED(rawVendorMrp, opts.conversion_rate, opts.increment_percent);
            const convertedSale = convertToAED(rawVendorSale, opts.conversion_rate, opts.increment_percent);

            // converted WITHOUT increment (to write into vmrp_to_aed / vsale_to_aed)
            const vmrp_to_aed = convertToAEDWithoutIncrement(rawVendorMrp, opts.conversion_rate);
            const vsale_to_aed = convertToAEDWithoutIncrement(rawVendorSale, opts.conversion_rate);

            const varRes = await client.query('SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL', [v.sku, productId]);
            if (varRes.rowCount) {
                const vid = varRes.rows[0].id;
                // Update existing variant - keep prior behavior, but add new fields
                await client.query(
                    `UPDATE product_variants SET
             vendor_id = $1,
             vendormrp = $2,
             vendorsaleprice = $3,
             mrp = $4,
             sale_price = $5,
             vmrp_to_aed = $6,
             vsale_to_aed = $7,
             currency = COALESCE($8, currency),
             conversion_rate = COALESCE($9, conversion_rate),
             price = $10,
             stock = $11,
             weight = $12,
             attributes = $13,
             images = $14,
             updated_at = now()
           WHERE id = $15`,
                    [
                        VENDOR_ID,
                        rawVendorMrp || null,
                        rawVendorSale || null,
                        convertedMrp,
                        convertedSale,
                        vmrp_to_aed,
                        vsale_to_aed,
                        opts.currency || null,
                        opts.conversion_rate || null,
                        v.price || null,
                        v.stock || 0,
                        v.weight || null,
                        helpers.toJsonb(v.attributes || null),
                        helpers.toJsonb(v.images || null),
                        vid
                    ]
                );
                createdVariants.push({ id: vid, sku: v.sku, updated: true });
            } else {
                // Insert new variant - match structure from your main importer (including vendor_id, currency, vmrp/vsale_to_aed)
                const variantId = randomUUID();
                const variantInsertText = `
          INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            price, mrp, sale_price, stock, weight, dimension,
            length, width, height, attributes, images, image_urls,
            video1, video2, vendormrp, vendorsaleprice, ourmrp, oursaleprice,
            tax, tax1, tax2, tax3, variant_color, variant_size,
            country_of_origin, is_active, normalized_size, normalized_color, size_type,
            currency, conversion_rate, vmrp_to_aed, vsale_to_aed, created_at, updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12,$13::jsonb,
            $14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,
            $20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,
            $33,$34,$35,$36,$37,$38,$39,$40, now(), now()
          ) RETURNING id
        `;

                const variantVals = [
                    variantId,                     // $1 id
                    VENDOR_ID,                     // $2 vendor_id
                    productId,                     // $3 product_id
                    v.sku,                         // $4 sku
                    v.barcode || null,             // $5 barcode
                    v.vendor_product_id || null,   // $6 vendor_product_id
                    null,                          // $7 productpartnersku
                    v.price || null,               // $8 price
                    convertedMrp,                  // $9 mrp (converted + increment)
                    convertedSale,                 // $10 sale_price (converted + increment)
                    v.stock || 0,                  // $11 stock
                    v.weight || null,              // $12 weight
                    helpers.toJsonb(v.dimension || null), // $13 dimension (jsonb)
                    v.length || null,              // $14 length
                    v.width || null,               // $15 width
                    v.height || null,              // $16 height
                    helpers.toJsonb(v.attributes || null),// $17 attributes (jsonb)
                    helpers.toJsonb(v.images || null),    // $18 images (jsonb)
                    null,                           // $19 image_urls
                    v.video1 || null,               // $20 video1
                    v.video2 || null,               // $21 video2
                    rawVendorMrp || null,           // $22 vendormrp (raw)
                    rawVendorSale || null,          // $23 vendorsaleprice (raw)
                    v.ourmrp || null,               // $24 ourmrp
                    v.oursaleprice || null,         // $25 oursaleprice
                    helpers.toJsonb(v.tax || null), // $26 tax (jsonb)
                    v.tax1 || null,                 // $27 tax1
                    v.tax2 || null,                 // $28 tax2
                    v.tax3 || null,                 // $29 tax3
                    v.variant_color || null,        // $30 variant_color
                    v.variant_size || null,         // $31 variant_size
                    v.country_of_origin || null,    // $32 country_of_origin
                    v.is_active !== undefined ? v.is_active : true, // $33 is_active
                    v.normalized_size || v.variant_size || null, // $34 normalized_size
                    v.normalized_color || v.variant_color || null, // $35 normalized_color
                    v.size_type || null,            // $36 size_type
                    opts.currency || null,          // $37 currency
                    opts.conversion_rate || null,   // $38 conversion_rate
                    vmrp_to_aed,                    // $39 vmrp_to_aed (without increment)
                    vsale_to_aed                    // $40 vsale_to_aed (without increment)
                ];

                const inVar = await client.query(variantInsertText, variantVals);
                createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

                // create inventory transaction (only on insert)
                if (v.stock && Number(v.stock) > 0) {
                    await client.query(
                        `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
             VALUES ($1,$2,$3,$4,$5, now())`,
                        [randomUUID(), inVar.rows[0].id, v.stock, 'initial_import', null]
                    );
                }
            }
        } // end variants loop

        // Link product -> default category if provided
        if (defaultCategoryId) {
            const exists = await client.query(
                'SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL',
                [productId, defaultCategoryId]
            );
            if (exists.rowCount === 0) {
                await client.query('INSERT INTO product_categories (id, product_id, category_id, vendor_id) VALUES ($1,$2,$3,$4)', [randomUUID(), productId, defaultCategoryId, VENDOR_ID]);
            }
        }

        // Dynamic filters (brand/color/size)
        const dyns = [];
        if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });
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
                    'INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name, vendor_id) VALUES ($1,$2,$3,$4,$5)',
                    [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]
                );
            }
        }

        // MEDIA logic (map sku -> variant id and upsert media)
        const skuToVariantId = new Map();
        for (const cv of createdVariants) if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);

        const existingVars = await client.query('SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL', [productId]);
        for (const row of existingVars.rows) if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);

        async function upsertMediaRow({ url, variant_id = null, type = 'image', name = null, metadata = {} }) {
            const { rows: exist } = await client.query(
                'SELECT id FROM media WHERE url = $1 AND (variant_id IS NOT DISTINCT FROM $2) AND deleted_at IS NULL LIMIT 1',
                [url, variant_id]
            );
            if (exist.length > 0) return exist[0].id;

            const mediaId = randomUUID();
            await client.query(
                'INSERT INTO media (id, name, variant_id, url, type, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6, now())',
                [mediaId, name, variant_id, url, type, helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))]
            );
            return mediaId;
        }

        // variant-level images
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

        // product-level images
        const productImageUrls = [product.product_img, product.product_img1, product.product_img2, product.product_img3, product.product_img4, product.product_img5].filter(Boolean);
        for (const url of productImageUrls) {
            if (!url) continue;
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

/* ---------------------
   Process single row (compat)
   --------------------- */
async function processRow(row, lineNumber, opts = {}) {
    const transformed = helpers.transformRowToProduct(row); // fallback single-row transform
    if (isBrandExcluded(transformed?.product?.brand_name)) {
        return { ok: true, skipped: true };
    }
    const client = await pool.connect();
    try {
        const res = await upsertProductAndVariant(client, transformed, opts);
        logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'imported');
        return { ok: true, productId: res.productId };
    } finally {
        client.release();
    }
}

/* ---------------------
   processCSVBuffer (grouped PRODUCT+MODEL rows)
   opts: { currency, conversion_rate, increment_percent, concurrency? }
   --------------------- */
/* async function processCSVBuffer(buffer, opts = {}) {
    const mergedOpts = Object.assign({}, DEFAULTS, opts);
    const { concurrency, errFileDir } = mergedOpts;
    console.log(errFileDir, "11111111111111");
    const Queue = await getPQueue();
    const queue = new Queue({ concurrency });

    const ERR_FILE = path.join(errFileDir, `import_errors_${Date.now()}.jsonl`);
    fs.writeFileSync(ERR_FILE, '');

    // read all rows (grouped format)
    const allRows = [];
    const csvStream = csv.parse({ headers: true, ignoreEmpty: true, trim: false })
        .on('error', err => {
            logger.error({ err }, 'csv parse error');
            throw err;
        })
        .on('data', row => {
            // normalize headers
            const normalized = {};
            for (const k of Object.keys(row)) {
                const nk = String(k).trim();
                normalized[nk] = row[k];
            }
            allRows.push(normalized);
        })
        .on('end', rowCount => {
            logger.info({ rowCount }, 'csv read finished; grouping rows by product_id');
        });

    const readable = new Readable();
    readable._read = () => { };
    readable.push(buffer);
    readable.push(null);
    readable.pipe(csvStream);

    await new Promise((resolve, reject) => {
        csvStream.on('end', resolve);
        csvStream.on('error', reject);
    });

    // group rows by product_id
    const groups = new Map();
    for (const r of allRows) {
        const pid = String(r['product_id'] || '').trim() || '__no_id__';
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(r);
    }

    let processedCount = 0;
    let errorCount = 0;

    for (const [pid, rows] of groups.entries()) {
        queue.add(async () => {
            // pick product row or fallback
            const productRow = rows.find(rr => String(rr['record_type'] || '').toUpperCase() === 'PRODUCT') || rows.find(rr => rr['code'] || rr['name']) || {};
            const modelRows = rows.filter(rr => String(rr['record_type'] || '').toUpperCase() === 'MODEL');

            try {
                const transformed = helpers.transformGroupedRows(productRow, modelRows);
                const client = await pool.connect();
                try {
                    const res = await upsertProductAndVariant(client, transformed, mergedOpts);
                    logger.info({ product_id: pid, productId: res.productId }, 'imported product group');
                    processedCount++;
                } finally {
                    client.release();
                }
            } catch (err) {
                errorCount++;
                const errLine = { product_id: pid, error: err.message, rows: rows.slice(0, 3) };
                fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
                logger.error({ product_id: pid, err: err.message }, 'import group error');
            }
        }).catch(e => {
            logger.error({ err: e.message || e }, 'queue add failed');
        });
    }

    await queue.onIdle();

    return { processedCount, errorCount, errorsPath: ERR_FILE };
} */

async function processCSVBuffer(buffer, opts = {}) {
    const mergedOpts = Object.assign({}, DEFAULTS, opts);
    const { concurrency, errFileDir } = mergedOpts;

    // USE THE SAME FILE PASSED FROM CONTROLLER
    const ERR_FILE = mergedOpts.errorFullPath;

    console.log("Using error file:", ERR_FILE);

    const Queue = await getPQueue();
    const queue = new Queue({ concurrency });

    const allRows = [];
    const csvStream = csv.parse({ headers: true, ignoreEmpty: true, trim: false })
        .on('error', err => {
            logger.error({ err }, 'csv parse error');
            throw err;
        })
        .on('data', row => {
            const normalized = {};
            for (const k of Object.keys(row)) {
                normalized[String(k).trim()] = row[k];
            }
            allRows.push(normalized);
        })
        .on('end', rowCount => {
            logger.info({ rowCount }, 'csv read finished; grouping rows by product_id');
        });

    const readable = new Readable();
    readable._read = () => { };
    readable.push(buffer);
    readable.push(null);
    readable.pipe(csvStream);

    await new Promise((resolve, reject) => {
        csvStream.on('end', resolve);
        csvStream.on('error', reject);
    });

    // group rows by product_id
    const groups = new Map();
    for (const r of allRows) {
        const pid = String(r['product_id'] || '').trim() || '__no_id__';
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(r);
    }

    let processedCount = 0;
    let errorCount = 0;

    for (const [pid, rows] of groups.entries()) {
        queue.add(async () => {
            const productRow =
                rows.find(rr => String(rr['record_type'] || '').toUpperCase() === 'PRODUCT') ||
                rows.find(rr => rr['code'] || rr['name']) ||
                {};

            const modelRows =
                rows.filter(rr => String(rr['record_type'] || '').toUpperCase() === 'MODEL');

            try {
                const transformed = helpers.transformGroupedRows(productRow, modelRows);
                if (isBrandExcluded(transformed?.product?.brand_name)) {
                    return;
                }
                const client = await pool.connect();

                try {
                    const res = await upsertProductAndVariant(client, transformed, mergedOpts);
                    logger.info({ product_id: pid, productId: res.productId }, 'imported product group');
                    processedCount++;
                } finally {
                    client.release();
                }
            } catch (err) {
                errorCount++;

                // WRITE TO THE SAME FILE
                const errLine = {
                    product_id: pid,
                    error: err.message,
                    rows: rows.slice(0, 3)
                };

                fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');

                logger.error({ product_id: pid, err: err.message }, 'import group error');
            }
        });
    }

    await queue.onIdle();

    return {
        processedCount,
        errorCount,
        errorsPath: ERR_FILE  // correct file path returned
    };
}


module.exports = {
    processCSVBuffer,
    ensureCategoryPath,
    upsertProductAndVariant
};
