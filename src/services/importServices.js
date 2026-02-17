// // services/importService.js
// const fs = require('fs');
// const path = require('path');
// const csv = require('fast-csv');
// const PQueue = require('p-queue').default;
// const pino = require('pino');
// const { Pool } = require('pg');
// const { randomUUID } = require("crypto");
// const { Readable } = require('stream');
// require('dotenv').config();

// const helpers = require('../../importHelpers');

// const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });

// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10),
// });

// // STATIC vendor id (as requested)
// const VENDOR_ID = 'b34fd0f6-815a-469e-b7c2-73f9e8afb3ed';

// const DEFAULTS = {
//     concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
//     errFileDir: process.cwd(),
//     batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10),
// };

// async function ensureCategoryPath(client, categoryPath) {
//     if (!categoryPath) return null;
//     const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
//     if (!parts || parts.length === 0) return null;

//     let parentId = null;
//     let parentPath = null;

//     for (const part of parts) {
//         const slug = helpers.slugify(part);
//         const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

//         // Single upsert prevents duplicates even with concurrent workers
//         const id = randomUUID();
//         const metadata = { created_via_import: true };

//         const { rows } = await client.query(
//             `
//       INSERT INTO categories (
//         id, vendor_id, name, slug, parent_id, path, is_active, metadata, created_at
//       )
//       VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
//       ON CONFLICT (vendor_id, path)
//       DO UPDATE SET
//         -- keep original parent if already present; otherwise set it
//         parent_id = COALESCE(categories.parent_id, EXCLUDED.parent_id),
//         -- keep existing name/slug if present; otherwise set them
//         name      = COALESCE(categories.name, EXCLUDED.name),
//         slug      = COALESCE(categories.slug, EXCLUDED.slug)
//       RETURNING id
//       `,
//             [id, VENDOR_ID, part, slug, parentId, currentPath, JSON.stringify(metadata)]
//         );

//         parentId = rows[0].id;
//         parentPath = currentPath;
//     }

//     return parentId;
// }

// async function upsertProductAndVariant(client, transformed) {
//     await client.query("BEGIN");
//     try {
//         const { product, variants = [], category_path } = transformed;
//         let defaultCategoryId = null;

//         if (category_path) {
//             defaultCategoryId = await ensureCategoryPath(client, category_path);
//         }

//         let productId = randomUUID();
//         const productSku = product.product_sku || null;
//         const productProductId = product.productid || null;

//         if (productSku) {
//             const insertProductSql = `
//                 INSERT INTO products (
//                     id, vendor_id, productid, product_sku, productpartnersku, name, title,
//                     short_description, description, brand_name, gender, default_category_id, attributes,
//                     product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
//                     product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
//                 ) VALUES (
//                     $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
//                     $13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,
//                     $19,$20::jsonb,$21,$22,$23,$24,$25, now(), now()
//                 )
//                 ON CONFLICT (product_sku) DO NOTHING
//                 RETURNING id
//             `;
//             const vals = [
//                 productId, VENDOR_ID, productProductId, productSku, null,
//                 product.name, product.title || null, product.short_description || null,
//                 product.description || null, product.brand_name || null, product.gender || null,
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

//             if (ins.rowCount === 0) {
//                 const sel = await client.query(
//                     `SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL LIMIT 1`,
//                     [productSku]
//                 );
//                 if (sel.rowCount === 0) throw new Error(`Unable to select product by product_sku=${productSku}`);
//                 productId = sel.rows[0].id;
//             } else {
//                 productId = ins.rows[0].id;
//             }

//         } else {
//             let existing = null;
//             if (productProductId) {
//                 const res = await client.query(
//                     `SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL`,
//                     [productProductId]
//                 );
//                 if (res.rowCount) existing = res.rows[0];
//             }

//             if (existing) {
//                 productId = existing.id;
//                 await client.query(
//                     `UPDATE products SET vendor_id = COALESCE(vendor_id, $1), default_category_id = COALESCE(default_category_id, $2), updated_at = now()
//                      WHERE id = $3`,
//                     [VENDOR_ID, defaultCategoryId, productId]
//                 );
//             } else {
//                 const insertProductSql = `
//                     INSERT INTO products (
//                         id, vendor_id, productid, product_sku, productpartnersku, name, title,
//                         short_description, description, brand_name, gender, default_category_id, attributes,
//                         product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
//                         product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
//                     ) VALUES (
//                         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
//                         $13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,
//                         $19,$20::jsonb,$21,$22,$23,$24,$25, now(), now()
//                     ) RETURNING id
//                 `;
//                 const vals = [
//                     productId, VENDOR_ID, productProductId, null, null,
//                     product.name, product.title || null,
//                     product.short_description || null,
//                     product.description || null,
//                     product.brand_name || null,
//                     product.gender || null,
//                     defaultCategoryId || null,
//                     helpers.toJsonb(product.attributes || null),
//                     helpers.toJsonb(product.product_meta || null),
//                     product.sizechart_text || null,
//                     product.sizechart_image || null,
//                     helpers.toJsonb(product.shipping_returns_payments || null),
//                     helpers.toJsonb(product.environmental_impact || null),
//                     product.product_img || null,
//                     helpers.toJsonb(product.videos || null),
//                     product.delivery_time || null,
//                     product.cod_available !== undefined ? product.cod_available : true,
//                     product.supplier || null,
//                     product.country_of_origin || null,
//                     product.is_active !== undefined ? product.is_active : true
//                 ];
//                 const ins = await client.query(insertProductSql, vals);
//                 productId = ins.rows[0].id;
//             }
//         }

//         const createdVariants = [];

//         for (const v of variants) {
//             if (!v.sku) {
//                 v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
//             }

//             const varRes = await client.query(
//                 `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL`,
//                 [v.sku, productId]
//             );

//             if (varRes.rowCount) {
//                 const vid = varRes.rows[0].id;
//                 await client.query(
//                     `UPDATE product_variants SET vendor_id=$1, price=$2, mrp=$3, sale_price=$4, stock=$5, weight=$6,
//                      attributes=$7, images=$8, updated_at=now()
//                      WHERE id=$9`,
//                     [
//                         VENDOR_ID,
//                         v.price || null,
//                         v.mrp || null,
//                         v.sale_price || null,
//                         v.stock || 0,
//                         v.weight || null,
//                         helpers.toJsonb(v.attributes || null),
//                         helpers.toJsonb(v.images || null),
//                         vid
//                     ]
//                 );
//                 createdVariants.push({ id: vid, sku: v.sku, updated: true });
//             } else {
//                 const variantId = randomUUID();

//                 const variantInsertText = `
//                     INSERT INTO product_variants (
//                         id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
//                         price, mrp, sale_price, stock, weight, dimension,
//                         length, width, height, attributes, images, image_urls,
//                         video1, video2, vendormrp, vendorsaleprice, ourmrp, oursaleprice,
//                         tax, tax1, tax2, tax3, variant_color, variant_size,
//                         country_of_origin, is_active, normalized_size, normalized_color, size_type,
//                         created_at, updated_at
//                     )
//                     VALUES (
//                         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
//                         $14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,
//                         $20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,
//                         $33,$34,$35,$36, now(),now()
//                     )
//                     RETURNING id
//                 `;

//                 const variantVals = [
//                     variantId,
//                     VENDOR_ID,
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
//                     v.normalized_size || null,
//                     v.normalized_color || null,
//                     v.size_type || null,
//                 ];

//                 if (variantVals.length !== 36) {
//                     throw new Error(`variantVals length mismatch: ${variantVals.length}`);
//                 }

//                 const inVar = await client.query(variantInsertText, variantVals);
//                 createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

//                 if (v.stock && Number(v.stock) > 0) {
//                     await client.query(
//                         `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
//                          VALUES ($1,$2,$3,$4,$5, now())`,
//                         [randomUUID(), inVar.rows[0].id, v.stock, "initial_import", null]
//                     );
//                 }
//             }
//         }

//         if (defaultCategoryId) {
//             const exists = await client.query(
//                 `SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL`,
//                 [productId, defaultCategoryId]
//             );
//             if (exists.rowCount === 0) {
//                 await client.query(
//                     `INSERT INTO product_categories (id, product_id, category_id,vendor_id) VALUES ($1,$2,$3,$4)`,
//                     [randomUUID(), productId, defaultCategoryId, VENDOR_ID]
//                 );
//             }
//         }

//         const dyns = [];
//         if (product.brand_name) dyns.push({ filter_type: "brand", filter_name: product.brand_name });

//         const firstVar = variants[0] || {};
//         if (firstVar.variant_color) dyns.push({ filter_type: "color", filter_name: firstVar.variant_color });
//         if (firstVar.variant_size) dyns.push({ filter_type: "size", filter_name: firstVar.variant_size });

//         for (const df of dyns) {
//             const ex = await client.query(
//                 `SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL`,
//                 [productId, df.filter_type, df.filter_name]
//             );
//             if (ex.rowCount === 0) {
//                 await client.query(
//                     `INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name,vendor_id)
//                      VALUES ($1,$2,$3,$4,$5)`,
//                     [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]
//                 );
//             }
//         }


//         /* ✅ MEDIA INSERT LOGIC STARTS HERE ✅ */

//         const skuToVariantId = new Map();
//         for (const cv of createdVariants) {
//             if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
//         }

//         const existingVars = await client.query(
//             `SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL`,
//             [productId]
//         );
//         for (const row of existingVars.rows) {
//             if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);
//         }

//         async function upsertMediaRow({ url, variant_id = null, type = "image", name = null, metadata = {} }) {
//             const { rows: exist } = await client.query(
//                 `SELECT id FROM media WHERE url = $1 AND (variant_id IS NOT DISTINCT FROM $2) AND deleted_at IS NULL LIMIT 1`,
//                 [url, variant_id]
//             );
//             if (exist.length > 0) return exist[0].id;

//             const mediaId = randomUUID();
//             await client.query(
//                 `INSERT INTO media (id, name, variant_id, url, type, metadata, created_at)
//                  VALUES ($1,$2,$3,$4,$5,$6, now())`,
//                 [
//                     mediaId,
//                     name,
//                     variant_id,
//                     url,
//                     type,
//                     helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))
//                 ]
//             );
//             return mediaId;
//         }

//         for (const v of variants) {
//             const imageUrls = Array.isArray(v.images)
//                 ? v.images
//                 : (v.images ? (typeof v.images === "string" ? [v.images] : []) : []);

//             if (!imageUrls || imageUrls.length === 0) continue;
//             const vid = skuToVariantId.get(v.sku) || null;

//             for (const url of imageUrls) {
//                 if (!url) continue;
//                 try {
//                     await upsertMediaRow({
//                         url,
//                         variant_id: vid,
//                         type: "image",
//                         metadata: { variant_sku: v.sku }
//                     });
//                 } catch (e) {
//                     console.error("media insert error (variant)", e.message || e);
//                 }
//             }
//         }

//         const productImageUrls = [
//             product.product_img,
//             product.product_img1,
//             product.product_img2,
//             product.product_img3,
//             product.product_img4,
//             product.product_img5
//         ].filter(Boolean);

//         for (const url of productImageUrls) {
//             if (!url) continue;
//             const { rows: already } = await client.query(
//                 `SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1`,
//                 [url]
//             );
//             if (already.length > 0) continue;

//             try {
//                 await upsertMediaRow({ url, variant_id: null, type: "image", metadata: {} });
//             } catch (e) {
//                 console.error("media insert error (product)", e.message || e);
//             }
//         }

//         /* ✅ MEDIA INSERT LOGIC ENDS HERE ✅ */


//         await client.query("COMMIT");
//         return { ok: true, productId, variants: createdVariants };

//     } catch (err) {
//         await client.query("ROLLBACK").catch(() => { });
//         throw err;
//     }
// }
// // Process single row
// async function processRow(row, lineNumber) {
//     const transformed = helpers.transformRowToProduct(row);
//     const client = await pool.connect();
//     try {
//         const res = await upsertProductAndVariant(client, transformed);
//         logger.info(
//             { line: lineNumber, productId: res.productId, variants: res.variants },
//             'imported'
//         );
//         return { ok: true, productId: res.productId };
//     } catch (err) {
//         throw err;
//     } finally {
//         client.release();
//     }
// }

// /**
//  * Process CSV buffer (uploaded file). Returns summary:
//  * { processedCount, errorCount, errorsPath }
//  *
//  * This function blocks until import completes.
//  */
// async function processCSVBuffer(buffer, opts = {}) {
//     const { concurrency, errFileDir } = Object.assign({}, DEFAULTS, opts);
//     const queue = new PQueue({ concurrency });

//     // make an error file unique to this run
//     const ERR_FILE = path.join(errFileDir, `import_errors_${Date.now()}.jsonl`);
//     fs.writeFileSync(ERR_FILE, '');

//     let lineNumber = 0;
//     let processedCount = 0;
//     let errorCount = 0;

//     // create a readable stream from buffer
//     const readable = new Readable();
//     readable._read = () => { };
//     readable.push(buffer);
//     readable.push(null);

//     const csvStream = csv
//         .parse({ headers: true, ignoreEmpty: true, trim: true })
//         .on('error', (err) => {
//             logger.error({ err }, 'csv parse error');
//             throw err;
//         })
//         .on('data', (row) => {
//             lineNumber++;
//             queue.add(async () => {
//                 try {
//                     await processRow(row, lineNumber);
//                     processedCount++;
//                 } catch (err) {
//                     errorCount++;
//                     const errLine = { line: lineNumber, error: err.message, row };
//                     fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
//                     logger.error({ line: lineNumber, err: err.message }, 'import error');
//                 }
//             });
//         })
//         .on('end', async (rowCount) => {
//             logger.info({ rowCount }, 'csv read finished; waiting for queue');
//         });

//     // pipe and wait for queue
//     readable.pipe(csvStream);
//     await queue.onIdle();

//     return { processedCount, errorCount, errorsPath: ERR_FILE };
// }

// module.exports = {
//     processCSVBuffer,
//     // export for unit tests or granular use:
//     ensureCategoryPath,
//     upsertProductAndVariant,
// };




// ===============================================
//after converting the prices and increment percent to AED, update the variants in the database


// // services/importService.js
// const fs = require('fs');
// const path = require('path');
// const csv = require('fast-csv');
// const PQueue = require('p-queue').default;
// const pino = require('pino');
// const { Pool } = require('pg');
// const { randomUUID } = require("crypto");
// const { Readable } = require('stream');
// require('dotenv').config();

// const helpers = require('../../importHelpers');

// const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });

// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10),
// });

// // STATIC vendor id (as requested)
// const VENDOR_ID = 'b34fd0f6-815a-469e-b7c2-73f9e8afb3ed';

// const DEFAULTS = {
//     concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
//     errFileDir: process.cwd(),
//     batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10),
// };

// /**
//  * Convert a numeric vendor price to AED and apply increment percent.
//  * - value: numeric or string (vendor price)
//  * - conversionRate: numeric (how many AED per vendor currency unit)
//  * - incrementPercent: numeric (e.g. 20 for +20%)
//  *
//  * Returns a float rounded to 2 decimals or null if input invalid.
//  */
// function convertToAED(value, conversionRate, incrementPercent) {
//     if (value === null || typeof value === 'undefined' || value === '') return null;
//     const num = Number(value);
//     if (Number.isNaN(num)) return null;
//     const baseAED = num * Number(conversionRate);
//     const inc = (baseAED * Number(incrementPercent)) / 100;
//     const finalVal = baseAED + inc;
//     return Number(finalVal.toFixed(2));
// }

// /**
//  * Ensure category path exists and return the deepest category id.
//  * Accepts strings like "Root -> Sub -> SubSub" or "Root/Sub".
//  */
// async function ensureCategoryPath(client, categoryPath) {
//     if (!categoryPath) return null;
//     const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
//     if (!parts || parts.length === 0) return null;

//     let parentId = null;
//     let parentPath = null;

//     for (const part of parts) {
//         const slug = helpers.slugify(part);
//         const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

//         // Single upsert prevents duplicates even with concurrent workers
//         const id = randomUUID();
//         const metadata = { created_via_import: true };

//         const { rows } = await client.query(
//             `
//       INSERT INTO categories (
//         id, vendor_id, name, slug, parent_id, path, is_active, metadata, created_at
//       )
//       VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
//       ON CONFLICT (vendor_id, path)
//       DO UPDATE SET
//         parent_id = COALESCE(categories.parent_id, EXCLUDED.parent_id),
//         name      = COALESCE(categories.name, EXCLUDED.name),
//         slug      = COALESCE(categories.slug, EXCLUDED.slug)
//       RETURNING id
//       `,
//             [id, VENDOR_ID, part, slug, parentId, currentPath, JSON.stringify(metadata)]
//         );

//         parentId = rows[0].id;
//         parentPath = currentPath;
//     }

//     return parentId;
// }

// /**
//  * Upsert product and its variants for a single transformed CSV row.
//  * - client: pg client
//  * - transformed: result of helpers.transformRowToProduct(row)
//  * - opts: { currency, conversion_rate, increment_percent }
//  */
// async function upsertProductAndVariant(client, transformed, opts = {}) {
//     await client.query('BEGIN');
//     try {
//         const { product, variants = [], category_path } = transformed;
//         let defaultCategoryId = null;

//         if (category_path) {
//             defaultCategoryId = await ensureCategoryPath(client, category_path);
//         }

//         let productId = randomUUID();
//         const productSku = product.product_sku || null;
//         const productProductId = product.productid || null;

//         // Insert or find product (original logic preserved)
//         if (productSku) {
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
//         )
//         ON CONFLICT (product_sku) DO NOTHING
//         RETURNING id
//       `;
//             const vals = [
//                 productId, VENDOR_ID, productProductId, productSku, null,
//                 product.name, product.title || null, product.short_description || null,
//                 product.description || null, product.brand_name || null, product.gender || null,
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

//             if (ins.rowCount === 0) {
//                 const sel = await client.query(
//                     `SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL LIMIT 1`,
//                     [productSku]
//                 );
//                 if (sel.rowCount === 0) throw new Error(`Unable to select product by product_sku=${productSku}`);
//                 productId = sel.rows[0].id;
//             } else {
//                 productId = ins.rows[0].id;
//             }
//         } else {
//             let existing = null;
//             if (productProductId) {
//                 const res = await client.query(
//                     `SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL`,
//                     [productProductId]
//                 );
//                 if (res.rowCount) existing = res.rows[0];
//             }

//             if (existing) {
//                 productId = existing.id;
//                 await client.query(
//                     `UPDATE products SET vendor_id = COALESCE(vendor_id, $1), default_category_id = COALESCE(default_category_id, $2), updated_at = now()
//            WHERE id = $3`,
//                     [VENDOR_ID, defaultCategoryId, productId]
//                 );
//             } else {
//                 const insertProductSql = `
//           INSERT INTO products (
//             id, vendor_id, productid, product_sku, productpartnersku, name, title,
//             short_description, description, brand_name, gender, default_category_id, attributes,
//             product_meta, sizechart_text, sizechart_image, shipping_returns_payments, environmental_impact,
//             product_img, videos, delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
//           ) VALUES (
//             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
//             $13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,
//             $19,$20::jsonb,$21,$22,$23,$24,$25, now(), now()
//           ) RETURNING id
//         `;
//                 const vals = [
//                     productId, VENDOR_ID, productProductId, null, null,
//                     product.name, product.title || null,
//                     product.short_description || null,
//                     product.description || null,
//                     product.brand_name || null,
//                     product.gender || null,
//                     defaultCategoryId || null,
//                     helpers.toJsonb(product.attributes || null),
//                     helpers.toJsonb(product.product_meta || null),
//                     product.sizechart_text || null,
//                     product.sizechart_image || null,
//                     helpers.toJsonb(product.shipping_returns_payments || null),
//                     helpers.toJsonb(product.environmental_impact || null),
//                     product.product_img || null,
//                     helpers.toJsonb(product.videos || null),
//                     product.delivery_time || null,
//                     product.cod_available !== undefined ? product.cod_available : true,
//                     product.supplier || null,
//                     product.country_of_origin || null,
//                     product.is_active !== undefined ? product.is_active : true
//                 ];
//                 const ins = await client.query(insertProductSql, vals);
//                 productId = ins.rows[0].id;
//             }
//         }

//         // ==== VARIANTS ====
//         const createdVariants = [];

//         for (const v of variants) {
//             // Ensure SKU
//             if (!v.sku) {
//                 v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
//             }

//             // Determine vendor raw fields (prioritize explicit vendormrp/vendorsaleprice if provided in CSV)
//             const rawVendorMrp = (typeof v.vendormrp !== 'undefined' && v.vendormrp !== null) ? v.vendormrp : v.mrp;
//             const rawVendorSale = (typeof v.vendorsaleprice !== 'undefined' && v.vendorsaleprice !== null) ? v.vendorsaleprice : v.sale_price;

//             // Convert vendor prices to AED and apply increment percent (opts should be provided from controller)
//             const convertedMrp = convertToAED(rawVendorMrp, opts.conversion_rate, opts.increment_percent);
//             const convertedSale = convertToAED(rawVendorSale, opts.conversion_rate, opts.increment_percent);

//             // Check if variant exists
//             const varRes = await client.query(
//                 `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL`,
//                 [v.sku, productId]
//             );

//             if (varRes.rowCount) {
//                 // Update existing variant (preserve other columns; update vendor raw fields + converted AED fields + currency info)
//                 const vid = varRes.rows[0].id;
//                 await client.query(
//                     `UPDATE product_variants SET
//              vendor_id = $1,
//              vendormrp = $2,
//              vendorsaleprice = $3,
//              mrp = $4,
//              sale_price = $5,
//              currency = COALESCE($6, currency),
//              conversion_rate = COALESCE($7, conversion_rate),
//              stock = $8,
//              weight = $9,
//              attributes = $10,
//              images = $11,
//              updated_at = now()
//            WHERE id = $12`,
//                     [
//                         VENDOR_ID,
//                         rawVendorMrp || null,
//                         rawVendorSale || null,
//                         convertedMrp,
//                         convertedSale,
//                         opts.currency || null,
//                         opts.conversion_rate || null,
//                         v.stock || 0,
//                         v.weight || null,
//                         helpers.toJsonb(v.attributes || null),
//                         helpers.toJsonb(v.images || null),
//                         vid
//                     ]
//                 );
//                 createdVariants.push({ id: vid, sku: v.sku, updated: true });

//                 // If stock provided and > 0 we may want to create an inventory transaction (existing code does this only on insert originally).
//                 // To preserve original behavior, we'll only add inventory transaction on new insert (same as original).
//             } else {
//                 // Insert new variant (store vendormrp/vendorsaleprice and computed AED fields and currency/conversion_rate)
//                 // Insert new variant (store vendormrp/vendorsaleprice and computed AED fields and currency/conversion_rate)
//                 const variantId = randomUUID();

//                 const variantInsertText = `
//   INSERT INTO product_variants (
//     id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
//     price, mrp, sale_price, stock, weight, dimension,
//     length, width, height, attributes, images, image_urls,
//     video1, video2, vendormrp, vendorsaleprice, ourmrp, oursaleprice,
//     tax, tax1, tax2, tax3, variant_color, variant_size,
//     country_of_origin, is_active, normalized_size, normalized_color, size_type,
//     currency, conversion_rate, created_at, updated_at
//   )
//   VALUES (
//     $1,$2,$3,$4,$5,$6,$7,
//     $8,$9,$10,$11,$12,$13::jsonb,
//     $14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,
//     $20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,
//     $33,$34,$35,$36,$37,$38,$39, now()
//   )
//   RETURNING id
// `;

//                 // Build variant values aligning with the INSERT above.
//                 const variantVals = [
//                     variantId,                      // $1 id
//                     VENDOR_ID,                      // $2 vendor_id
//                     productId,                      // $3 product_id
//                     v.sku,                          // $4 sku
//                     v.barcode || null,              // $5 barcode
//                     v.vendor_product_id || null,    // $6 vendor_product_id
//                     null,                           // $7 productpartnersku (kept null as original)
//                     v.price || null,                // $8 price (raw price if any)
//                     convertedMrp,                   // $9 mrp (converted AED + increment)
//                     convertedSale,                  // $10 sale_price (converted AED + increment)
//                     v.stock || 0,                   // $11 stock
//                     v.weight || null,               // $12 weight
//                     helpers.toJsonb(v.dimension || null), // $13 dimension (jsonb)
//                     v.length || null,               // $14 length
//                     v.width || null,                // $15 width
//                     v.height || null,               // $16 height
//                     helpers.toJsonb(v.attributes || null),// $17 attributes (jsonb)
//                     helpers.toJsonb(v.images || null),    // $18 images (jsonb)
//                     null,                           // $19 image_urls (kept null)
//                     v.video1 || null,               // $20 video1
//                     v.video2 || null,               // $21 video2
//                     rawVendorMrp || null,           // $22 vendormrp (raw vendor mrp)
//                     rawVendorSale || null,          // $23 vendorsaleprice (raw vendor sale)
//                     v.ourmrp || null,               // $24 ourmrp
//                     v.oursaleprice || null,         // $25 oursaleprice
//                     helpers.toJsonb(v.tax || null), // $26 tax (jsonb)
//                     v.tax1 || null,                 // $27 tax1
//                     v.tax2 || null,                 // $28 tax2
//                     v.tax3 || null,                 // $29 tax3
//                     v.variant_color || null,        // $30 variant_color
//                     v.variant_size || null,         // $31 variant_size
//                     v.country_of_origin || null,    // $32 country_of_origin
//                     v.is_active !== undefined ? v.is_active : true, // $33 is_active
//                     v.normalized_size || null,      // $34 normalized_size
//                     v.normalized_color || null,     // $35 normalized_color
//                     v.size_type || null,            // $36 size_type
//                     opts.currency || null,          // $37 currency
//                     opts.conversion_rate || null,   // $38 conversion_rate
//                     new Date()                      // $39 created_at
//                 ];

//                 // Insert new variant
//                 const inVar = await client.query(variantInsertText, variantVals);
//                 createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

//                 // If stock provided and > 0 then create initial inventory transaction (preserve original behavior)
//                 if (v.stock && Number(v.stock) > 0) {
//                     await client.query(
//                         `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
//              VALUES ($1,$2,$3,$4,$5, now())`,
//                         [randomUUID(), inVar.rows[0].id, v.stock, 'initial_import', null]
//                     );
//                 }
//             }
//         } // end for variants

//         // === Link product -> default category if provided (preserve original behavior) ===
//         if (defaultCategoryId) {
//             const exists = await client.query(
//                 `SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL`,
//                 [productId, defaultCategoryId]
//             );
//             if (exists.rowCount === 0) {
//                 await client.query(
//                     `INSERT INTO product_categories (id, product_id, category_id, vendor_id) VALUES ($1,$2,$3,$4)`,
//                     [randomUUID(), productId, defaultCategoryId, VENDOR_ID]
//                 );
//             }
//         }

//         // === Dynamic filters (brand/color/size) (preserve original behavior) ===
//         const dyns = [];
//         if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });

//         const firstVar = variants[0] || {};
//         if (firstVar.variant_color) dyns.push({ filter_type: 'color', filter_name: firstVar.variant_color });
//         if (firstVar.variant_size) dyns.push({ filter_type: 'size', filter_name: firstVar.variant_size });

//         for (const df of dyns) {
//             const ex = await client.query(
//                 `SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL`,
//                 [productId, df.filter_type, df.filter_name]
//             );
//             if (ex.rowCount === 0) {
//                 await client.query(
//                     `INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name, vendor_id)
//            VALUES ($1,$2,$3,$4,$5)`,
//                     [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]
//                 );
//             }
//         }

//         /* ✅ MEDIA INSERT LOGIC STARTS HERE (preserve original behavior) ✅ */

//         // Build sku -> variant id map for createdVariants + existing ones
//         const skuToVariantId = new Map();
//         for (const cv of createdVariants) {
//             if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
//         }

//         const existingVars = await client.query(
//             `SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL`,
//             [productId]
//         );
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
//                 `INSERT INTO media (id, name, variant_id, url, type, metadata, created_at)
//          VALUES ($1,$2,$3,$4,$5,$6, now())`,
//                 [
//                     mediaId,
//                     name,
//                     variant_id,
//                     url,
//                     type,
//                     helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))
//                 ]
//             );
//             return mediaId;
//         }

//         // Variant-level images
//         for (const v of variants) {
//             const imageUrls = Array.isArray(v.images)
//                 ? v.images
//                 : (v.images ? (typeof v.images === 'string' ? [v.images] : []) : []);

//             if (!imageUrls || imageUrls.length === 0) continue;
//             const vid = skuToVariantId.get(v.sku) || null;

//             for (const url of imageUrls) {
//                 if (!url) continue;
//                 try {
//                     await upsertMediaRow({
//                         url,
//                         variant_id: vid,
//                         type: 'image',
//                         metadata: { variant_sku: v.sku }
//                     });
//                 } catch (e) {
//                     // keep import resilient: log and continue
//                     console.error('media insert error (variant)', e.message || e);
//                 }
//             }
//         }

//         // Product-level images
//         const productImageUrls = [
//             product.product_img,
//             product.product_img1,
//             product.product_img2,
//             product.product_img3,
//             product.product_img4,
//             product.product_img5
//         ].filter(Boolean);

//         for (const url of productImageUrls) {
//             if (!url) continue;
//             const { rows: already } = await client.query(
//                 `SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1`,
//                 [url]
//             );
//             if (already.length > 0) continue;

//             try {
//                 await upsertMediaRow({ url, variant_id: null, type: 'image', metadata: {} });
//             } catch (e) {
//                 console.error('media insert error (product)', e.message || e);
//             }
//         }

//         /* ✅ MEDIA INSERT LOGIC ENDS HERE ✅ */

//         await client.query('COMMIT');
//         return { ok: true, productId, variants: createdVariants };
//     } catch (err) {
//         await client.query('ROLLBACK').catch(() => { });
//         throw err;
//     }
// }

// /**
//  * Process single CSV row.
//  * - row: parsed CSV row
//  * - lineNumber: for error logging
//  * - opts: passed through from processCSVBuffer (contains currency/conversion_rate/etc)
//  */
// async function processRow(row, lineNumber, opts) {
//     const transformed = helpers.transformRowToProduct(row);
//     const client = await pool.connect();
//     try {
//         const res = await upsertProductAndVariant(client, transformed, opts);
//         logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'imported');
//         return { ok: true, productId: res.productId };
//     } catch (err) {
//         throw err;
//     } finally {
//         client.release();
//     }
// }

// /**
//  * Process CSV buffer (uploaded file). Returns summary:
//  * { processedCount, errorCount, errorsPath }
//  *
//  * This function blocks until import completes.
//  */
// async function processCSVBuffer(buffer, opts = {}) {
//     const mergedOpts = Object.assign({}, DEFAULTS, opts);
//     const { concurrency, errFileDir } = mergedOpts;
//     const queue = new PQueue({ concurrency });

//     // make an error file unique to this run
//     const ERR_FILE = path.join(errFileDir, `import_errors_${Date.now()}.jsonl`);
//     fs.writeFileSync(ERR_FILE, '');

//     let lineNumber = 0;
//     let processedCount = 0;
//     let errorCount = 0;

//     // create a readable stream from buffer
//     const readable = new Readable();
//     readable._read = () => { };
//     readable.push(buffer);
//     readable.push(null);

//     const csvStream = csv
//         .parse({ headers: true, ignoreEmpty: true, trim: true })
//         .on('error', (err) => {
//             logger.error({ err }, 'csv parse error');
//             throw err;
//         })
//         .on('data', (row) => {
//             lineNumber++;
//             queue.add(async () => {
//                 try {
//                     await processRow(row, lineNumber, mergedOpts);
//                     processedCount++;
//                 } catch (err) {
//                     errorCount++;
//                     const errLine = { line: lineNumber, error: err.message, row };
//                     fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
//                     logger.error({ line: lineNumber, err: err.message }, 'import error');
//                 }
//             });
//         })
//         .on('end', async (rowCount) => {
//             logger.info({ rowCount }, 'csv read finished; waiting for queue');
//         });

//     // pipe and wait for queue
//     readable.pipe(csvStream);
//     await queue.onIdle();

//     return { processedCount, errorCount, errorsPath: ERR_FILE };
// }

// module.exports = {
//     processCSVBuffer,
//     // export for unit tests or granular use:
//     ensureCategoryPath,
//     upsertProductAndVariant,
// };


// ============================


// services/importService.js
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

const helpers = require('../../importHelpers');
const { normalizeBrandName } = require("../utils/normalize");

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || 'info' });
 
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.PG_MAX_CLIENTS || '20', 10),
});

// STATIC vendor id (as requested)
const VENDOR_ID = 'b34fd0f6-815a-469e-b7c2-73f9e8afb3ed';

const DEFAULTS = {
    concurrency: parseInt(process.env.IMPORT_CONCURRENCY || '4', 10),
    errFileDir: process.cwd(),
    batchSize: parseInt(process.env.IMPORT_BATCH_SIZE || '100', 10),
};

/**
 * Convert vendor price to AED and apply increment percent
 * returns null if input invalid
 */
function convertToAED(value, conversionRate, incrementPercent) {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const baseAED = num * Number(conversionRate);
    const inc = (baseAED * Number(incrementPercent)) / 100;
    return Number((baseAED + inc).toFixed(2));
}

/**
 * Convert vendor price to AED (without increment)
 */
function convertToAEDWithoutIncrement(value, conversionRate) {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    const baseAED = num * Number(conversionRate);
    return Number(baseAED.toFixed(2));
}

/**
 * Ensure category path exists and return the deepest category id.
 * Accepts strings like "Root -> Sub -> SubSub" or "Root/Sub".
 */
async function ensureCategoryPath(client, categoryPath) {
    if (!categoryPath) return null;
    const parts = categoryPath.split(/->|\/|>/).map(p => p.trim()).filter(Boolean);
    if (!parts || parts.length === 0) return null;

    let parentId = null;
    let parentPath = null;

    for (const part of parts) {
        const slug = helpers.slugify(part);
        const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

        // Single upsert prevents duplicates even with concurrent workers
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

/**
 * Upsert product and variants for a single transformed CSV row.
 * - client: pg client
 * - transformed: result of helpers.transformRowToProduct(row)
 * - opts: { currency, conversion_rate, increment_percent, concurrency? }
 */
async function upsertProductAndVariant(client, transformed, opts = {}) {
    await client.query('BEGIN');
    try {
        const { product, variants = [], category_path } = transformed;
        let defaultCategoryId = null;

        if (category_path) {
            defaultCategoryId = await ensureCategoryPath(client, category_path);
        }

        let productId = randomUUID();
        const productSku = product.product_sku || null;
        const productProductId = product.productid || null;

        // Insert or find product (unchanged)
        if (productSku) {
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
        )
        ON CONFLICT (product_sku) DO NOTHING
        RETURNING id
      `;
            const vals = [
                productId, VENDOR_ID, productProductId, productSku, null,
                product.name, product.title || null, product.short_description || null,
                product.description || null, product.brand_name || null, normalizeBrandName(product.brand_name), product.gender || null,
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

            if (ins.rowCount === 0) {
                const sel = await client.query(
                    `SELECT id FROM products WHERE product_sku = $1 AND deleted_at IS NULL LIMIT 1`,
                    [productSku]
                );
                if (sel.rowCount === 0) throw new Error(`Unable to select product by product_sku=${productSku}`);
                productId = sel.rows[0].id;
            } else {
                productId = ins.rows[0].id;
            }
        } else {
            let existing = null;
            if (productProductId) {
                const res = await client.query(
                    `SELECT id FROM products WHERE productid = $1 AND deleted_at IS NULL`,
                    [productProductId]
                );
                if (res.rowCount) existing = res.rows[0];
            }

            if (existing) {
                productId = existing.id;
                await client.query(
                    `UPDATE products SET vendor_id = COALESCE(vendor_id, $1), default_category_id = COALESCE(default_category_id, $2), updated_at = now()
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
                    productId, VENDOR_ID, productProductId, null, null,
                    product.name, product.title || null,
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
        }

        // ==== VARIANTS ====
        const createdVariants = [];

        for (const v of variants) {
            if (!v.sku) {
                v.sku = `${product.product_sku || productId}-${Math.random().toString(36).slice(2, 8)}`;
            }

            const rawVendorMrp = (typeof v.vendormrp !== 'undefined' && v.vendormrp !== null) ? v.vendormrp : v.mrp;
            const rawVendorSale = (typeof v.vendorsaleprice !== 'undefined' && v.vendorsaleprice !== null) ? v.vendorsaleprice : v.sale_price;

            // converted + increment (for mrp/sale_price)
            const convertedMrp = convertToAED(rawVendorMrp, opts.conversion_rate, opts.increment_percent);
            const convertedSale = convertToAED(rawVendorSale, opts.conversion_rate, opts.increment_percent);

            // converted without increment (for vmrp_to_aed, vsale_to_aed)
            const vmrp_to_aed = convertToAEDWithoutIncrement(rawVendorMrp, opts.conversion_rate);
            const vsale_to_aed = convertToAEDWithoutIncrement(rawVendorSale, opts.conversion_rate);

            const varRes = await client.query(
                `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL`,
                [v.sku, productId]
            );

            if (varRes.rowCount) {
                const vid = varRes.rows[0].id;

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
             stock = $10,
             weight = $11,
             attributes = $12,
             images = $13,
             updated_at = now()
           WHERE id = $14`,
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
                        v.stock || 0,
                        v.weight || null,
                        helpers.toJsonb(v.attributes || null),
                        helpers.toJsonb(v.images || null),
                        vid
                    ]
                );

                createdVariants.push({ id: vid, sku: v.sku, updated: true });
            } else {
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
          )
          RETURNING id
        `;

                const variantVals = [
                    variantId,                      // $1 id
                    VENDOR_ID,                      // $2 vendor_id
                    productId,                      // $3 product_id
                    v.sku,                          // $4 sku
                    v.barcode || null,              // $5 barcode
                    v.vendor_product_id || null,    // $6 vendor_product_id
                    null,                           // $7 productpartnersku
                    v.price || null,                // $8 price
                    convertedMrp,                   // $9 mrp (converted + increment)
                    convertedSale,                  // $10 sale_price (converted + increment)
                    v.stock || 0,                   // $11 stock
                    v.weight || null,               // $12 weight
                    helpers.toJsonb(v.dimension || null), // $13 dimension (jsonb)
                    v.length || null,               // $14 length
                    v.width || null,                // $15 width
                    v.height || null,               // $16 height
                    helpers.toJsonb(v.attributes || null),// $17 attributes (jsonb)
                    helpers.toJsonb(v.images || null),    // $18 images (jsonb)
                    null,                           // $19 image_urls
                    v.video1 || null,               // $20 video1
                    v.video2 || null,               // $21 video2
                    rawVendorMrp || null,           // $22 vendormrp (raw vendor mrp)
                    rawVendorSale || null,          // $23 vendorsaleprice (raw vendor sale)
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
                    vmrp_to_aed,                    // $39 vmrp_to_aed (converted without increment)
                    vsale_to_aed                    // $40 vsale_to_aed (converted without increment)
                ];

                const inVar = await client.query(variantInsertText, variantVals);
                createdVariants.push({ id: inVar.rows[0].id, sku: v.sku, created: true });

                // inventory transaction (only on insert, preserving original behavior)
                if (v.stock && Number(v.stock) > 0) {
                    await client.query(
                        `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
             VALUES ($1,$2,$3,$4,$5, now())`,
                        [randomUUID(), inVar.rows[0].id, v.stock, 'initial_import', null]
                    );
                }
            }
        } // end for variants

        // === Link product -> default category if provided (preserve original behavior) ===
        if (defaultCategoryId) {
            const exists = await client.query(
                `SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL`,
                [productId, defaultCategoryId]
            );
            if (exists.rowCount === 0) {
                await client.query(
                    `INSERT INTO product_categories (id, product_id, category_id, vendor_id) VALUES ($1,$2,$3,$4)`,
                    [randomUUID(), productId, defaultCategoryId, VENDOR_ID]
                );
            }
        }

        // === Dynamic filters (brand/color/size) (preserve original behavior) ===
        const dyns = [];
        if (product.brand_name) dyns.push({ filter_type: 'brand', filter_name: product.brand_name });

        const firstVar = variants[0] || {};
        if (firstVar.variant_color) dyns.push({ filter_type: 'color', filter_name: firstVar.variant_color });
        if (firstVar.variant_size) dyns.push({ filter_type: 'size', filter_name: firstVar.variant_size });

        for (const df of dyns) {
            const ex = await client.query(
                `SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL`,
                [productId, df.filter_type, df.filter_name]
            );
            if (ex.rowCount === 0) {
                await client.query(
                    `INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name, vendor_id)
           VALUES ($1,$2,$3,$4,$5)`,
                    [randomUUID(), productId, df.filter_type, df.filter_name, VENDOR_ID]
                );
            }
        }

        /* ✅ MEDIA INSERT LOGIC STARTS HERE (preserve original behavior) ✅ */

        // Build sku -> variant id map for createdVariants + existing ones
        const skuToVariantId = new Map();
        for (const cv of createdVariants) {
            if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
        }

        const existingVars = await client.query(
            `SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL`,
            [productId]
        );
        for (const row of existingVars.rows) {
            if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);
        }

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
                [
                    mediaId,
                    name,
                    variant_id,
                    url,
                    type,
                    helpers.toJsonb(Object.assign({ imported: true, product_id: productId }, metadata))
                ]
            );
            return mediaId;
        }

        // Variant-level images
        for (const v of variants) {
            const imageUrls = Array.isArray(v.images)
                ? v.images
                : (v.images ? (typeof v.images === 'string' ? [v.images] : []) : []);

            if (!imageUrls || imageUrls.length === 0) continue;
            const vid = skuToVariantId.get(v.sku) || null;

            for (const url of imageUrls) {
                if (!url) continue;
                try {
                    await upsertMediaRow({
                        url,
                        variant_id: vid,
                        type: 'image',
                        metadata: { variant_sku: v.sku }
                    });
                } catch (e) {
                    // keep import resilient: log and continue
                    console.error('media insert error (variant)', e.message || e);
                }
            }
        }

        // Product-level images
        const productImageUrls = [
            product.product_img,
            product.product_img1,
            product.product_img2,
            product.product_img3,
            product.product_img4,
            product.product_img5
        ].filter(Boolean);

        for (const url of productImageUrls) {
            if (!url) continue;
            const { rows: already } = await client.query(
                `SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1`,
                [url]
            );
            if (already.length > 0) continue;

            try {
                await upsertMediaRow({ url, variant_id: null, type: 'image', metadata: {} });
            } catch (e) {
                console.error('media insert error (product)', e.message || e);
            }
        }

        /* ✅ MEDIA INSERT LOGIC ENDS HERE ✅ */

        await client.query('COMMIT');
        return { ok: true, productId, variants: createdVariants };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
}

/**
 * Process single CSV row.
 * - row: parsed CSV row
 * - lineNumber: for error logging
 * - opts: passed through from processCSVBuffer (contains currency/conversion_rate/etc)
 */
async function processRow(row, lineNumber, opts) {
    const transformed = helpers.transformRowToProduct(row);
    const client = await pool.connect();
    try {
        const res = await upsertProductAndVariant(client, transformed, opts);
        logger.info({ line: lineNumber, productId: res.productId, variants: res.variants }, 'imported');
        return { ok: true, productId: res.productId };
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Process CSV buffer (uploaded file). Returns summary:
 * { processedCount, errorCount, errorsPath }
 *
 * This function blocks until import completes.
 */
// async function processCSVBuffer(buffer, opts = {}) {
//     const mergedOpts = Object.assign({}, DEFAULTS, opts);
//     const { concurrency, errFileDir } = mergedOpts;
//     const queue = new PQueue({ concurrency });

//     // make an error file unique to this run
//     const ERR_FILE = path.join(errFileDir, `import_errors_${Date.now()}.jsonl`);
//     fs.writeFileSync(ERR_FILE, '');

//     let lineNumber = 0;
//     let processedCount = 0;
//     let errorCount = 0;

//     // create a readable stream from buffer
//     const readable = new Readable();
//     readable._read = () => { };
//     readable.push(buffer);
//     readable.push(null);

//     const csvStream = csv
//         .parse({ headers: true, ignoreEmpty: true, trim: true })
//         .on('error', (err) => {
//             logger.error({ err }, 'csv parse error');
//             throw err;
//         })
//         .on('data', (row) => {
//             lineNumber++;
//             queue.add(async () => {
//                 try {
//                     await processRow(row, lineNumber, mergedOpts);
//                     processedCount++;
//                 } catch (err) {
//                     errorCount++;
//                     const errLine = { line: lineNumber, error: err.message, row };
//                     fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');
//                     logger.error({ line: lineNumber, err: err.message }, 'import error');
//                 }
//             });
//         })
//         .on('end', async (rowCount) => {
//             logger.info({ rowCount }, 'csv read finished; waiting for queue');
//         });

//     // pipe and wait for queue
//     readable.pipe(csvStream);
//     await queue.onIdle();

//     return { processedCount, errorCount, errorsPath: ERR_FILE };
// }

async function processCSVBuffer(buffer, opts = {}) {
    const mergedOpts = Object.assign({}, DEFAULTS, opts);
    const { concurrency } = mergedOpts;

    // ❤️ USE THE SAME FILE PASSED FROM CONTROLLER
    const ERR_FILE = mergedOpts.errorFullPath;

    const Queue = await getPQueue();
    const queue = new Queue({ concurrency });

    let lineNumber = 0;
    let processedCount = 0;
    let errorCount = 0;

    // create a readable stream from buffer
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
                    await processRow(row, lineNumber, mergedOpts);
                    processedCount++;
                } catch (err) {
                    errorCount++;

                    const errLine = {
                        line: lineNumber,
                        error: err.message,
                        row
                    };

                    // ❤️ append to the SAME FILE
                    fs.appendFileSync(ERR_FILE, JSON.stringify(errLine) + '\n');

                    logger.error({ line: lineNumber, err: err.message }, 'import error');
                }
            });
        })
        .on('end', async (rowCount) => {
            logger.info({ rowCount }, 'csv read finished; waiting for queue');
        });

    readable.pipe(csvStream);

    await queue.onIdle();

    return {
        processedCount,
        errorCount,
        errorsPath: ERR_FILE
    };
}


module.exports = {
    processCSVBuffer,
    // export for unit tests or granular use:
    ensureCategoryPath,
    upsertProductAndVariant,
};
