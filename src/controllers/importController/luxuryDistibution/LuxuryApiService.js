// luxuryImportService.js
const { Pool } = require("pg");
const pino = require("pino");
const { randomUUID } = require("crypto");
const path = require("path");
// require("dotenv").config({ path: "../../../../.env" });
require("dotenv").config({ path: "../../../../.env" });
const dbPool = require("../../../db/dbConnection");
const { normalizeBrandName } = require("../../../utils/normalize");
// const dotenv = require("dotenv");

// dotenv.config();

const { getLuxuryToken, getLuxuryProduct } = require("./luxuryHelper"); // 👈 path adjust karna agar alag ho

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || "info" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_MAX_CLIENTS || "20", 10),
});

const LUXURY_VENDOR_ID = "65053474-4e40-44ee-941c-ef5253ea9fc9";

/* -------------------------
   Helpers: slugify / toJsonb
   ------------------------- */
function slugify(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents hatao
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toJsonb(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function normalizeGenderValue(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (["man", "men", "mens"].includes(normalized)) return "men";
  if (["woman", "women", "womens", "ladies"].includes(normalized)) return "women";
  if (["boy", "boys"].includes(normalized)) return "boys";
  if (["girl", "girls"].includes(normalized)) return "girls";
  if (["kids", "children", "child"].includes(normalized)) return "kids";
  if (normalized.includes("unisex")) return "unisex";
  return normalized;
}
/* -------------------------
   Price conversion helpers
   ------------------------- */

// vendor price → AED + increment
function convertToAED(value, conversionRate, incrementPercent) {
  if (value === null || typeof value === "undefined" || value === "")
    return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const baseAED = num * Number(conversionRate);
  const inc = (baseAED * Number(incrementPercent)) / 100;
  return Number((baseAED + inc).toFixed(2));
}

// vendor price → AED (NO increment)
function convertToAEDWithoutIncrement(value, conversionRate) {
  if (value === null || typeof value === "undefined" || value === "")
    return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const baseAED = num * Number(conversionRate);
  return Number(baseAED.toFixed(2));
}

/* -------------------------
   Ensure category path
   (Women > Shoes > Sneakers)
   ------------------------- */
async function ensureCategoryPath(client, categoryPath) {
  if (!categoryPath) {
    console.log("⚠️  No category path provided");
    return null;
  }
  const parts = String(categoryPath)
    .split(/->|>|\/|>/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) {
    console.log("⚠️  Empty category path after parsing");
    return null;
  }

  console.log(`📁 Processing category path: "${categoryPath}" → [${parts.join(" > ")}]`);

  let parentId = null;
  let parentPath = null;

  for (const part of parts) {
    const slug = slugify(part);
    const currentPath = parentPath ? `${parentPath}/${slug}` : slug;

    const found = await client.query(
      `SELECT id FROM categories WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
      [currentPath]
    );
    if (found.rowCount > 0) {
      parentId = found.rows[0].id;
      parentPath = currentPath;
      console.log(`   ✓ Category exists: "${part}" (${currentPath})`);
      continue;
    }

    const id = randomUUID();
    const metadata = { created_via_import: true };

    const insertSql = `
      INSERT INTO categories (
        id, name, slug, parent_id, path, vendor_id, is_active, metadata, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,true,$7, now())
      RETURNING id
    `;
    const insertParams = [
      id,
      part,
      slug,
      parentId,
      currentPath,
      LUXURY_VENDOR_ID,
      JSON.stringify(metadata),
    ];
    const ins = await client.query(insertSql, insertParams);
    parentId = ins.rows[0].id;
    parentPath = currentPath;
    console.log(`   ➕ Created vendor category: "${part}" (${currentPath})`);
  }

  console.log(`✅ Final category ID: ${parentId}`);
  return parentId;
}

/* -------------------------
   Transform Luxury API → { product, variants, category_path }
   ------------------------- */
function transformLuxuryProduct(api) {
  const {
    id,
    brand,
    year,
    variant,
    color_detail,
    color_supplier,
    made_in,
    material,
    name,
    description,
    size_info,
    size_quantity,
    qty,
    supplier,
    original_price,
    product_category_id,
    products_tags,
    brand_model_number,
    hs_code,
    ean,
    images = [],
    sku,
    category_string,
    gender,
    season_one,
    season_two,
    selling_price,
    cost,
  } = api;

  const vendorSalePrice = selling_price ? Number(selling_price) : null;
  if (vendorSalePrice !== null && vendorSalePrice < 6) {
    return null;
  }

  // build size map & variants (C: per-size variants + size map in product_meta)
  const sizeQuantityMap = {};
  const variants = [];

  if (Array.isArray(size_quantity)) {
    for (const entry of size_quantity) {
      if (!entry || typeof entry !== "object") continue;
      const size = Object.keys(entry)[0];
      const rawQty = entry[size];
      const stock = Number(rawQty || 0);
      sizeQuantityMap[size] = stock;

      // we still create variant even if stock = 0
      const variantSku = `${sku}-${size}`;

      variants.push({
        sku: variantSku,
        vendor_product_id: String(id),
        variant_size: size,
        variant_color: color_detail || null,
        stock,
        price: selling_price, // raw vendor selling price (currency from API)
        vendormrp: original_price, // raw vendor MRP
        vendorsaleprice: selling_price, // raw vendor sale price (or cost)
        ourmrp: null,
        oursaleprice: null,
        tax: null,
        tax1: null,
        tax2: null,
        tax3: null,
        country_of_origin: made_in || null,
        is_active: true,
        normalized_size: size,
        normalized_color: color_detail || null,
        size_type: size_info || null,
        images, // same image array per variant
        attributes: {
          size,
          color: color_detail,
          year,
          material,
        },
        dimension: null,
        length: null,
        width: null,
        height: null,
        video1: null,
        video2: null,
      });
    }
  }

  const totalStock = variants.reduce(
    (sum, variant) => sum + (Number(variant.stock) || 0),
    0
  );
  const isActiveByStock = totalStock > 0;

  const genderName = normalizeGenderValue(gender?.name || null);
  const season1 = season_one?.name || null;
  const season2 = season_two?.name || null;

  const product_meta = {
    year,
    color_detail,
    color_supplier,
    made_in,
    material,
    size_info,
    size_quantity_map: sizeQuantityMap,
    total_qty: qty,
    supplier,
    original_price,
    selling_price,
    cost,
    product_category_id,
    products_tags,
    brand_model_number,
    hs_code,
    ean,
    season_one: season1,
    season_two: season2,
  };

  const attributes = {
    brand,
    gender: genderName,
    category_string,
    color: color_detail,
    season_one: season1,
    season_two: season2,
  };

  const productImages = images || [];
  const [img0, img1, img2, img3, img4, img5] = productImages;

  const product = {
    productid: String(id),
    product_sku: sku,
    name,
    title: `${brand || ""} ${name || ""}`.trim(),
    short_description: null,
    description: description || null,
    brand_name: brand || null,
    gender: genderName,
    attributes,
    product_meta,
    sizechart_text: null,
    sizechart_image: null,
    shipping_returns_payments: null,
    environmental_impact: null,
    product_img: img0 || null,
    product_img1: img1 || null,
    product_img2: img2 || null,
    product_img3: img3 || null,
    product_img4: img4 || null,
    product_img5: img5 || null,
    videos: null,
    delivery_time: null,
    cod_available: true,
    supplier: supplier ? String(supplier) : null,
    country_of_origin: made_in || null,
    is_active: isActiveByStock,
  };

  const category_path = category_string || null;

  return { product, variants, category_path };
}

/* -------------------------
   Upsert product + variants
   opts: { currency, conversion_rate, increment_percent }
   ------------------------- */
async function upsertProductAndVariant(client, transformed, opts = {}) {
  await client.query("BEGIN");
  try {
    const { product, variants = [], category_path } = transformed;

    console.log(`\n🔄 Processing product: "${product.name}" (SKU: ${product.product_sku})`);

    let defaultCategoryId = null;
    if (category_path) {
      defaultCategoryId = await ensureCategoryPath(client, category_path);
    } else {
      console.log("⚠️  No category path for this product");
    }

    // find existing product ONLY by product_sku (as you asked)
    let existing = null;
    if (product.product_sku) {
      const res = await client.query(
        "SELECT id, default_category_id FROM products WHERE product_sku = $1 AND deleted_at IS NULL",
        [product.product_sku]
      );
      if (res.rowCount) {
        existing = res.rows[0];
        console.log(`   ℹ️  Product exists in DB (ID: ${existing.id})`);
      } else {
        console.log(`   ℹ️  New product - will be inserted`);
      }
    }

    let productId = existing ? existing.id : randomUUID();

    if (existing) {
      // Check if product has "our category" mapping
      const categoryCheck = await client.query(
        `SELECT c.is_our_category, c.name, c.path
         FROM categories c
         WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [existing.default_category_id]
      );

      if (categoryCheck.rowCount > 0 && categoryCheck.rows[0].is_our_category) {
        console.log(`   🔒 PRESERVING "our category": "${categoryCheck.rows[0].name}" (${categoryCheck.rows[0].path})`);
      } else {
        console.log(`   🔄 Updating vendor category to: ${category_path || 'NULL'}`);
      }
      // update important fields (name, desc, brand, images, meta, attributes, category, supplier, etc.)
      // PRESERVE "our category" if already mapped by admin
      await client.query(
        `
        UPDATE products SET
          name = $1,
          title = $2,
          short_description = $3,
          description = $4,
          brand_name = $5,
          brand_name_normalized = $6,
          gender = $7,
          default_category_id = CASE
            WHEN default_category_id IN (
              SELECT id FROM categories WHERE is_our_category = true AND deleted_at IS NULL
            ) THEN default_category_id  -- Keep our category mapping
            ELSE $8                      -- Update to new vendor category
          END,
          attributes = $9::jsonb,
          product_meta = $10::jsonb,
          product_img = $11,
          product_img1 = $12,
          product_img2 = $13,
          product_img3 = $14,
          product_img4 = $15,
          product_img5 = $16,
          supplier = $17,
          country_of_origin = $18,
          is_active = $19,
          updated_at = now()
        WHERE id = $20
      `,
        [
          product.name,
          product.title,
          product.short_description,
          product.description,
          product.brand_name,
          normalizeBrandName(product.brand_name),
          product.gender,
          defaultCategoryId,
          toJsonb(product.attributes),
          toJsonb(product.product_meta),
          product.product_img,
          product.product_img1,
          product.product_img2,
          product.product_img3,
          product.product_img4,
          product.product_img5,
          product.supplier,
          product.country_of_origin,
          product.is_active !== undefined ? product.is_active : true,
          productId,
        ]
      );
      console.log(`   ✅ Product updated successfully`);
    } else {
      // insert new product
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
        LUXURY_VENDOR_ID,
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
        toJsonb(product.attributes || null),
        toJsonb(product.product_meta || null),
        product.sizechart_text || null,
        product.sizechart_image || null,
        toJsonb(product.shipping_returns_payments || null),
        toJsonb(product.environmental_impact || null),
        product.product_img || null,
        toJsonb(product.videos || null),
        product.delivery_time || null,
        product.cod_available !== undefined ? product.cod_available : true,
        product.supplier || null,
        product.country_of_origin || null,
        product.is_active !== undefined ? product.is_active : true,
      ];
      const ins = await client.query(insertProductSql, vals);
      productId = ins.rows[0].id;
      console.log(`   ✅ Product inserted successfully (ID: ${productId})`);
    }

    // VARIANTS
    console.log(`   🔢 Processing ${variants.length} variant(s)...`);
    const createdVariants = [];

    for (const v of variants) {
      if (!v.sku) {
        v.sku = `${product.product_sku || productId}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
      }

      console.log(`      → Variant SKU: ${v.sku} | Size: ${v.variant_size || 'N/A'} | Color: ${v.variant_color || 'N/A'} | Stock: ${v.stock || 0}`);

      const rawVendorMrp = v.vendormrp ?? null;
      const rawVendorSale = v.vendorsaleprice ?? v.price ?? null;

      // Tiered markup pricing: >1000 → 28%, 501–1000 → 37%, else 45%
      let ourPrice = null;
      let ourMrp = null;

      if (rawVendorSale && Number(rawVendorSale) > 0) {
        let markupPercentage;
        const salePrice = Number(rawVendorSale);

        if (salePrice > 1000) {
          markupPercentage = 0.28;
        } else if (salePrice >= 501) {
          markupPercentage = 0.37;
        } else {
          markupPercentage = 0.45;
        }

        ourPrice = Math.round(salePrice * (1 + markupPercentage));

        if (rawVendorMrp && Number(rawVendorMrp) > salePrice) {
          const vendorDiscount = (Number(rawVendorMrp) - salePrice) / Number(rawVendorMrp);
          ourMrp = Math.round(ourPrice / (1 - vendorDiscount));
        } else {
          ourMrp = ourPrice;
        }
      }

      console.log(`         💰 Price: Vendor EUR ${rawVendorSale} → Our EUR ${ourPrice} | Vendor MRP EUR ${rawVendorMrp} → Our MRP EUR ${ourMrp}`);

      const varRes = await client.query(
        "SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL",
        [v.sku, productId]
      );

      if (varRes.rowCount) {
        const vid = varRes.rows[0].id;
        console.log(`         ✓ Variant exists - updating (ID: ${vid})`);
        await client.query(
          `
          UPDATE product_variants SET
            vendor_id        = $1,
            vendormrp        = $2,
            vendorsaleprice  = $3,
            mrp              = $4,
            price            = $5,
            stock            = $6,
            weight           = $7,
            attributes       = $8,
            images           = $9,
            variant_color    = $10,
            variant_size     = $11,
            country_of_origin= $12,
            normalized_size  = $13,
            normalized_color = $14,
            size_type        = $15,
            updated_at       = now()
          WHERE id = $16
        `,
          [
            LUXURY_VENDOR_ID,
            rawVendorMrp || null,
            rawVendorSale || null,
            ourMrp,
            ourPrice,
            v.stock || 0,
            v.weight || null,
            toJsonb(v.attributes || null),
            toJsonb(v.images || null),
            v.variant_color || null,
            v.variant_size || null,
            v.country_of_origin || null,
            v.normalized_size || v.variant_size || null,
            v.normalized_color || v.variant_color || null,
            v.size_type || null,
            vid,
          ]
        );
        createdVariants.push({ id: vid, sku: v.sku, updated: true });
      } else {
        console.log(`         ➕ New variant - inserting`);
        const variantId = randomUUID();

        const variantInsertText = `
          INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            price, mrp, stock, weight, dimension,
            length, width, height, attributes, images, image_urls,
            video1, video2, vendormrp, vendorsaleprice,
            tax, tax1, tax2, tax3, variant_color, variant_size,
            country_of_origin, is_active, normalized_size, normalized_color, size_type,
            created_at, updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12::jsonb,
            $13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,
            $19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28,
            $29,$30,$31,$32,$33, now(), now()
          ) RETURNING id
        `;

        const variantVals = [
          variantId, // $1
          LUXURY_VENDOR_ID, // $2
          productId, // $3
          v.sku, // $4
          v.barcode || null, // $5
          v.vendor_product_id || product.productid || null, // $6
          null, // $7 productpartnersku
          ourPrice, // $8 price (our calculated price = vendorsaleprice * 3)
          ourMrp, // $9 mrp (our calculated MRP)
          v.stock || 0, // $10 stock
          v.weight || null, // $11 weight
          toJsonb(v.dimension || null), // $12 dimension
          v.length || null, // $13
          v.width || null, // $14
          v.height || null, // $15
          toJsonb(v.attributes || null), // $16 attributes
          toJsonb(v.images || null), // $17 images
          null, // $18 image_urls
          v.video1 || null, // $19
          v.video2 || null, // $20
          rawVendorMrp || null, // $21 vendormrp
          rawVendorSale || null, // $22 vendorsaleprice
          toJsonb(v.tax || null), // $23 tax
          v.tax1 || null, // $24
          v.tax2 || null, // $25
          v.tax3 || null, // $26
          v.variant_color || null, // $27
          v.variant_size || null, // $28
          v.country_of_origin || null, // $29
          v.is_active !== undefined ? v.is_active : true, // $30
          v.normalized_size || v.variant_size || null, // $31
          v.normalized_color || v.variant_color || null, // $32
          v.size_type || null, // $33
        ];

        const inVar = await client.query(variantInsertText, variantVals);
        createdVariants.push({
          id: inVar.rows[0].id,
          sku: v.sku,
          created: true,
        });

        if (v.stock && Number(v.stock) > 0) {
          console.log(`         📦 Creating inventory transaction: +${v.stock} units`);
          await client.query(
            `
            INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
            VALUES ($1,$2,$3,$4,$5, now())
          `,
            [randomUUID(), inVar.rows[0].id, v.stock, "initial_import_luxury", null]
          );
        }
      }
    }

    console.log(`   ✅ All variants processed (${createdVariants.length} total)`);

    // Product → category link
    if (defaultCategoryId) {
      const exists = await client.query(
        "SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL",
        [productId, defaultCategoryId]
      );
      if (exists.rowCount === 0) {
        console.log(`   🔗 Linking product to category in product_categories table`);
        await client.query(
          "INSERT INTO product_categories (id, product_id, category_id, vendor_id) VALUES ($1,$2,$3,$4)",
          [randomUUID(), productId, defaultCategoryId, LUXURY_VENDOR_ID]
        );
      }
    }

    // Dynamic filters
    const dyns = [];
    if (product.brand_name)
      dyns.push({ filter_type: "brand", filter_name: product.brand_name });

    const firstVar = variants[0] || {};
    if (firstVar.variant_color)
      dyns.push({ filter_type: "color", filter_name: firstVar.variant_color });
    if (firstVar.variant_size)
      dyns.push({ filter_type: "size", filter_name: firstVar.variant_size });

    for (const df of dyns) {
      const ex = await client.query(
        "SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL",
        [productId, df.filter_type, df.filter_name]
      );
      if (ex.rowCount === 0) {
        await client.query(
          "INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name, vendor_id) VALUES ($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            productId,
            df.filter_type,
            df.filter_name,
            LUXURY_VENDOR_ID,
          ]
        );
      }
    }

    // MEDIA
    const skuToVariantId = new Map();
    for (const cv of createdVariants) {
      if (cv && cv.id && cv.sku) skuToVariantId.set(cv.sku, cv.id);
    }
    const existingVars = await client.query(
      "SELECT id, sku FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL",
      [productId]
    );
    for (const row of existingVars.rows) {
      if (!skuToVariantId.has(row.sku)) skuToVariantId.set(row.sku, row.id);
    }

    async function upsertMediaRow({
      url,
      variant_id = null,
      type = "image",
      name = null,
      metadata = {},
    }) {
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
          toJsonb(
            Object.assign({ imported: true, product_id: productId }, metadata)
          ),
        ]
      );
      return mediaId;
    }

    // variant-level images
    for (const v of variants) {
      const imageUrls = Array.isArray(v.images)
        ? v.images
        : v.images
        ? typeof v.images === "string"
          ? [v.images]
          : []
        : [];

      if (!imageUrls.length) continue;
      const vid = skuToVariantId.get(v.sku) || null;

      for (const url of imageUrls) {
        if (!url) continue;
        try {
          await upsertMediaRow({
            url,
            variant_id: vid,
            type: "image",
            metadata: { variant_sku: v.sku },
          });
        } catch (e) {
          logger.error(
            { err: e.message || e, url },
            "media insert error (variant)"
          );
        }
      }
    }

    // product-level images
    const productImageUrls = [
      product.product_img,
      product.product_img1,
      product.product_img2,
      product.product_img3,
      product.product_img4,
      product.product_img5,
    ].filter(Boolean);

    for (const url of productImageUrls) {
      if (!url) continue;
      const { rows: already } = await client.query(
        `SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1`,
        [url]
      );
      if (already.length > 0) continue;

      try {
        await upsertMediaRow({
          url,
          variant_id: null,
          type: "image",
          metadata: {},
        });
      } catch (e) {
        logger.error(
          { err: e.message || e, url },
          "media insert error (product)"
        );
      }
    }

    await client.query("COMMIT");
    console.log(`✅ Product "${product.name}" committed successfully\n`);
    return { ok: true, productId, variants: createdVariants };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log(`❌ ROLLBACK: Error processing product - ${err.message}\n`);
    throw err;
  }
}

/* -------------------------
   MAIN Sync function
   jobId: UUID of the sync job for tracking progress
   ------------------------- */
async function syncLuxuryProducts(jobId) {
  const { VendorSyncJobService } = require("../../../services/vendorSyncJobService");

  let page = 1;
  const limit = 100;
  let totalFetched = 0;
  let totalProducts = 0;
  let successCount = 0;
  let errorCount = 0;
  const syncedProductSkus = new Set(); // Track all synced product SKUs

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     🚀 LUXURY DISTRIBUTION PRODUCT SYNC STARTED                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`📋 Job ID: ${jobId}`);
  console.log(`   → Batch Size: ${limit} products per page\n`);

  let token = await getLuxuryToken();
  console.log("🔑 Authentication token obtained successfully\n");
  const client = await dbPool.connect();

  try {
    logger.info("🚀 Starting Luxury Distribution product sync...");

    while (true) {
      // Check for cancellation request
      const shouldCancel = await VendorSyncJobService.shouldCancelJob(client, jobId);
      if (shouldCancel) {
        console.log(`\n🛑 Cancellation requested - stopping sync gracefully`);
        await VendorSyncJobService.completeSyncJob(
          client,
          jobId,
          'cancelled',
          'Cancelled by user'
        );
        console.log("✅ Sync job marked as cancelled");
        break;
      }

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📄 Fetching page ${page}...`);

      const result = await getLuxuryProduct(page, limit, token);
      const { data, total, newToken } = result;

      // Update token if it was refreshed during the API call
      if (newToken) {
        token = newToken;
        console.log("🔑 Token updated after refresh");
      }

      if (!data || data.length === 0) {
        console.log(`⚠️  No more products found. Ending sync.`);
        break;
      }

      totalProducts = total;
      console.log(`📦 Retrieved ${data.length} products (Total available: ${total})`);
      console.log(`📊 Progress: ${totalFetched}/${total} (${((totalFetched/total)*100).toFixed(1)}%)\n`);

      // Update total products on first page
      if (page === 1) {
        await VendorSyncJobService.updateSyncProgress(client, jobId, {
          totalProducts: total,
          currentPage: page,
        });
      }

      logger.info(
        {
          page,
          count: data.length,
          total,
        },
        "📦 Fetched product page from Luxury"
      );

      for (const item of data) {
        try {
          const transformed = transformLuxuryProduct(item);
          if (!transformed) {
            continue;
          }
          if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) {
            continue;
          }
          await upsertProductAndVariant(client, transformed, {});
          // Track synced product SKU
          if (transformed.product.product_sku) {
            syncedProductSkus.add(transformed.product.product_sku);
          }
          totalFetched += 1;
          successCount += 1;
        } catch (e) {
          errorCount += 1;
          console.log(`\n❌ ERROR processing product: ${item.name || item.sku || item.id}`);
          console.log(`   Error: ${e.message}`);
          logger.error(
            { product_id: item.id, sku: item.sku, err: e.message },
            "❌ Insert/Update error"
          );
        }
      }

      console.log(`\n✓ Page ${page} completed: ${successCount} succeeded, ${errorCount} failed`);

      // Update progress after each page
      await VendorSyncJobService.updateSyncProgress(client, jobId, {
        processedProducts: totalFetched,
        successfulProducts: successCount,
        failedProducts: errorCount,
        currentPage: page,
      });

      page += 1;

      if (totalFetched >= total) {
        console.log(`\n🎯 All products processed!`);
        break;
      }
    }

    // Mark products not in sync as inactive
    if (syncedProductSkus.size > 0) {
      console.log(`\n🔄 Marking orphan products as inactive...`);
      const skuArray = Array.from(syncedProductSkus);
      const orphanResult = await client.query(
        `UPDATE products
         SET is_active = false, updated_at = now()
         WHERE vendor_id = $1
         AND product_sku IS NOT NULL
         AND product_sku NOT IN (SELECT unnest($2::text[]))
         AND is_active = true
         AND deleted_at IS NULL`,
        [LUXURY_VENDOR_ID, skuArray]
      );
      const orphanCount = orphanResult.rowCount;
      console.log(`   → Marked ${orphanCount} orphan product(s) as inactive`);
    }

    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║     ✅ LUXURY DISTRIBUTION SYNC COMPLETED                      ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log(`📊 Final Results:`);
    console.log(`   → Total Products Available: ${totalProducts}`);
    console.log(`   → Successfully Synced: ${successCount}`);
    console.log(`   → Failed: ${errorCount}`);
    console.log(`   → Success Rate: ${totalProducts > 0 ? ((successCount/totalProducts)*100).toFixed(1) : 0}%\n`);

    // Mark job as completed
    await VendorSyncJobService.completeSyncJob(
      client,
      jobId,
      'completed',
      null,
      null
    );
    console.log("✅ Sync job marked as completed");

    logger.info(
      { totalFetched, totalProducts, successCount, errorCount },
      "✅ Luxury products synced successfully"
    );

    return { totalFetched, totalProducts, successCount, errorCount };
  } catch (err) {
    // Mark job as failed on error
    console.error("❌ Sync failed with error:", err.message);
    try {
      await VendorSyncJobService.completeSyncJob(
        client,
        jobId,
        'failed',
        err.message,
        { stack: err.stack }
      );
      console.log("✅ Sync job marked as failed");
    } catch (updateErr) {
      console.error("❌ Failed to update job status:", updateErr.message);
    }
    throw err;
  } finally {
    client.release();
    console.log("🔌 Database connection released\n");
  }
}

module.exports = {
  syncLuxuryProducts,
};
