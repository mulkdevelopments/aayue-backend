const { Pool } = require("pg");
const pino = require("pino");
const { randomUUID } = require("crypto");
const dbPool = require("../../../db/dbConnection");
const { normalizeBrandName } = require("../../../utils/normalize");
const {
  fetchProductsPage,
  fetchProductById,
} = require("./brandsgatewayHelper");
const { getMarginSettings, computeTieredPricing } = require("../../../utils/marginHelper");

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || "info" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_MAX_CLIENTS || "20", 10),
});

const BRANDS_GATEWAY_VENDOR_ID = "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c";
const STORE_ID = Number(process.env.BRANDSGATEWAY_STORE_ID || 0) || 0;
const BG_BLOCKED_KEYWORDS = ["doll", "dolls", "baby doll", "barbie"];

let cachedPLimit = null;
async function getPLimit() {
  if (cachedPLimit) return cachedPLimit;
  const mod = await import("p-limit");
  cachedPLimit = mod.default;
  return cachedPLimit;
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

function resolveAttributeOption(attributes, predicate) {
  if (!Array.isArray(attributes)) return null;
  const match = attributes.find((attr) => {
    const name = String(attr?.name || "").toLowerCase();
    return predicate(name);
  });
  return match?.option || match?.options?.[0] || null;
}

function normalizeImageList(images) {
  if (!Array.isArray(images)) return [];
  return images.map((img) => img?.src).filter(Boolean);
}

function stripHtml(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDescription(raw) {
  const text = stripHtml(raw);
  if (!text) return null;

  const normalized = text.replace(/[\u2013\u2014]/g, " - ");
  const parts = normalized
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) return normalized;
  return `${parts[0]}<br/>- ${parts.slice(1).join("<br/>- ")}`;
}

function getMetaValue(metaData, keys) {
  if (!Array.isArray(metaData) || metaData.length === 0) return null;
  const normalizedKeys = keys.map((k) => String(k).toLowerCase());
  const match = metaData.find((entry) => {
    const key = String(entry?.key || "").toLowerCase().trim();
    return normalizedKeys.includes(key);
  });
  return match?.value || null;
}

function parseCountryFromDescription(rawDescription) {
  const text = stripHtml(rawDescription);
  if (!text) return null;
  const match = text.match(/made in\s*[:\-]?\s*([A-Za-z\s]+)/i);
  if (!match) return null;
  const candidate = match[1]
    .split(/gender|composition/i)[0]
    .split(/[\u2013\u2014\-]/)[0]
    .trim();
  return candidate || null;
}

function containsBlockedKeyword(value) {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  return BG_BLOCKED_KEYWORDS.some((kw) => normalized.includes(kw));
}

async function transformBrandsgatewayProduct(product, marginConfig) {
  if (!product) return null;

  const blockedText = `${product?.name || ""} ${product?.description || ""}`;
  if (containsBlockedKeyword(blockedText)) {
    return null;
  }

  const conditionId = product?.condition?.id ? String(product.condition.id) : null;
  if (conditionId && conditionId !== "71354") {
    return null;
  }

  const brandName = Array.isArray(product.brands) ? product.brands[0] : null;
  const genderName = normalizeGenderValue(product.gender?.name || null);
  const imageUrls = normalizeImageList(product.images);
  const categoryIds = Array.isArray(product.categories)
    ? product.categories.map((id) => Number(id)).filter(Boolean)
    : [];
  const description = formatDescription(product.description);
  const countryFromMeta = getMetaValue(product.meta_data, [
    "made in",
    "made_in",
    "country",
    "country_of_origin",
    "origin",
  ]);
  const countryFromDesc = parseCountryFromDescription(product.description);
  const countryOfOrigin = countryFromMeta || countryFromDesc || null;

  const variants = [];
  const variations = Array.isArray(product.variations) ? product.variations : [];

  if (variations.length > 0) {
    for (const variation of variations) {
      const salePrice = variation.sale_price ? Number(variation.sale_price) : null;
      if (salePrice !== null && salePrice < 6) {
        continue;
      }

      const regularPrice = variation.regular_price
        ? Number(variation.regular_price)
        : null;
      const { ourPrice, ourMrp } = computeTieredPricing(salePrice, regularPrice, marginConfig);

      const variantSize =
        resolveAttributeOption(variation.attributes, (name) =>
          name.includes("size")
        ) ||
        resolveAttributeOption(product.attributes, (name) =>
          name.includes("size")
        );
      const variantColor =
        resolveAttributeOption(variation.attributes, (name) =>
          name.includes("color")
        ) ||
        resolveAttributeOption(product.attributes, (name) =>
          name.includes("color")
        );

      const stock = variation.manage_stock
        ? Number(variation.stock_quantity || 0)
        : variation.in_stock
        ? 1
        : 0;

      variants.push({
        sku: variation.sku || product.sku || `${product.id}-${variation.id}`,
        vendor_product_id: variation.id ? String(variation.id) : null,
        variant_size: variantSize || null,
        variant_color: variantColor || null,
        normalized_size: variantSize || null,
        normalized_color: variantColor || null,
        stock,
        vendormrp: regularPrice,
        vendorsaleprice: salePrice,
        price: ourPrice,
        mrp: ourMrp,
        images: normalizeImageList([variation.image || {}]).concat(imageUrls),
        attributes: {
          size: variantSize || null,
          color: variantColor || null,
          barcode: variation.barcode || null,
        },
        is_active: stock > 0,
      });
    }
  } else {
    const salePrice = product.sale_price ? Number(product.sale_price) : null;
    if (salePrice !== null && salePrice < 6) {
      return null;
    }

    const regularPrice = product.regular_price
      ? Number(product.regular_price)
      : null;
    const { ourPrice, ourMrp } = computeTieredPricing(salePrice, regularPrice, marginConfig);

    const variantSize = resolveAttributeOption(product.attributes, (name) =>
      name.includes("size")
    );
    const variantColor = resolveAttributeOption(product.attributes, (name) =>
      name.includes("color")
    );

    const stock = product.manage_stock
      ? Number(product.stock_quantity || 0)
      : product.in_stock
      ? 1
      : 0;

    variants.push({
      sku: product.sku || String(product.id),
      vendor_product_id: String(product.id),
      variant_size: variantSize || null,
      variant_color: variantColor || null,
      normalized_size: variantSize || null,
      normalized_color: variantColor || null,
      stock,
      vendormrp: regularPrice,
      vendorsaleprice: salePrice,
      price: ourPrice,
      mrp: ourMrp,
      images: imageUrls,
      attributes: {
        size: variantSize || null,
        color: variantColor || null,
        barcode: product.barcode || null,
      },
      is_active: stock > 0,
    });
  }

  if (variants.length === 0) {
    return null;
  }

  const totalStock = variants.reduce(
    (sum, variant) => sum + (Number(variant.stock) || 0),
    0
  );

  const productMeta = {
    vendor: product.vendor || null,
    condition: product.condition || null,
    category_ids: categoryIds,
    stock_status: product.stock_status || null,
    product_type: product.type || null,
    gender: product.gender || null,
    meta_data: product.meta_data || [],
    made_in: countryOfOrigin,
  };

  const productPayload = {
    productid: String(product.id),
    product_sku: product.sku || null,
    name: product.name || "",
    title: product.name || "",
    short_description: null,
    description,
    brand_name: brandName || null,
    gender: genderName,
    attributes: {
      brand: brandName || null,
      gender: genderName,
      category_ids: categoryIds,
    },
    product_meta: productMeta,
    product_img: imageUrls[0] || null,
    product_img1: imageUrls[0] || null,
    product_img2: imageUrls[1] || null,
    product_img3: imageUrls[2] || null,
    product_img4: imageUrls[3] || null,
    product_img5: imageUrls[4] || null,
    supplier: brandName || null,
    country_of_origin: countryOfOrigin,
    is_active: totalStock > 0 && product.in_stock !== false,
  };

  return { product: productPayload, variants, category_path: null };
}

async function ensureCategoryPath(client, categoryPath) {
  if (!categoryPath) return null;
  const parts = String(categoryPath)
    .split(/->|>|\/|>/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  let parentId = null;
  let parentPath = null;

  for (const part of parts) {
    const currentPath = parentPath ? `${parentPath} > ${part}` : part;
    const res = await client.query(
      `SELECT id, path FROM categories WHERE path = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [currentPath, BRANDS_GATEWAY_VENDOR_ID]
    );

    if (res.rowCount) {
      parentId = res.rows[0].id;
      parentPath = res.rows[0].path;
      continue;
    }

    const id = randomUUID();
    const slug = part
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const metadata = { vendor: "Brandsgateway" };

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
      BRANDS_GATEWAY_VENDOR_ID,
      JSON.stringify(metadata),
    ];
    const ins = await client.query(insertSql, insertParams);
    parentId = ins.rows[0].id;
    parentPath = currentPath;
  }

  return parentId;
}

async function upsertProductAndVariants(client, transformed) {
  await client.query("BEGIN");
  try {
    const { product, variants = [], category_path } = transformed;
    let defaultCategoryId = null;

    if (category_path) {
      defaultCategoryId = await ensureCategoryPath(client, category_path);
    }

    let existing = null;
    if (product.productid) {
      const res = await client.query(
        `SELECT id, default_category_id, manually_edited_at FROM products WHERE productid = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.productid, BRANDS_GATEWAY_VENDOR_ID]
      );
      if (res.rowCount) existing = res.rows[0];
    }

    if (!existing && product.product_sku) {
      const res = await client.query(
        `SELECT id, default_category_id, manually_edited_at FROM products WHERE product_sku = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.product_sku, BRANDS_GATEWAY_VENDOR_ID]
      );
      if (res.rowCount) existing = res.rows[0];
    }

    if (existing && existing.manually_edited_at) {
      return { productId: existing.id, variantCount: 0, skipped: "manually_edited" };
    }

    const { checkAndMarkSuspiciousIfNeeded } = require("../competitorCheck");
    const suspicious = await checkAndMarkSuspiciousIfNeeded(client, product, existing?.id);
    if (suspicious) {
      return { productId: existing?.id ?? null, variantCount: 0, skipped: "suspicious", reason: suspicious.reason };
    }

    let productId = existing ? existing.id : null;
    if (!productId && product.productid) {
      const deleted = await client.query(
        `SELECT id FROM products WHERE productid = $1 AND vendor_id = $2 AND deleted_at IS NOT NULL LIMIT 1`,
        [product.productid, BRANDS_GATEWAY_VENDOR_ID]
      );
      if (deleted.rowCount) return { productId: null, variantCount: 0, skipped: "deleted" };
    }
    if (!productId) productId = randomUUID();

    if (existing) {
      await client.query(
        `
          UPDATE products SET
            name = $1,
            title = $2,
            description = $3,
            brand_name = $4,
            brand_name_normalized = $5,
            product_sku = $6,
            gender = $7,
            default_category_id = CASE
              WHEN default_category_id IN (
                SELECT id FROM categories WHERE is_our_category = true AND deleted_at IS NULL
              ) THEN default_category_id
              ELSE $8
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
          product.description,
          product.brand_name,
          normalizeBrandName(product.brand_name),
          product.product_sku,
          product.gender || null,
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
        BRANDS_GATEWAY_VENDOR_ID,
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
        null,
        null,
        null,
        null,
        product.product_img || null,
        null,
        null,
        true,
        product.supplier || null,
        product.country_of_origin || null,
        product.is_active !== undefined ? product.is_active : true,
      ];

      const ins = await client.query(insertProductSql, vals);
      productId = ins.rows[0].id;
    }

    const createdVariants = [];

    for (const v of variants) {
      const variantLookup = v.vendor_product_id
        ? await client.query(
            `SELECT id FROM product_variants WHERE vendor_product_id = $1 AND product_id = $2 AND deleted_at IS NULL`,
            [v.vendor_product_id, productId]
          )
        : await client.query(
            `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL`,
            [v.sku, productId]
          );

      if (variantLookup.rowCount) {
        const vid = variantLookup.rows[0].id;
        await client.query(
          `
            UPDATE product_variants SET
              vendor_id = $1,
              sku = $2,
              vendor_product_id = $3,
              vendormrp = $4,
              vendorsaleprice = $5,
              mrp = $6,
              price = $7,
              stock = $8,
              attributes = $9,
              images = $10,
              variant_color = $11,
              variant_size = $12,
              normalized_size = $13,
              normalized_color = $14,
              updated_at = now()
            WHERE id = $15
          `,
          [
            BRANDS_GATEWAY_VENDOR_ID,
            v.sku,
            v.vendor_product_id || null,
            v.vendormrp || null,
            v.vendorsaleprice || null,
            v.mrp || null,
            v.price || null,
            v.stock || 0,
            toJsonb(v.attributes || null),
            toJsonb(v.images || null),
            v.variant_color || null,
            v.variant_size || null,
            v.normalized_size || null,
            v.normalized_color || null,
            vid,
          ]
        );
        createdVariants.push({ id: vid, sku: v.sku, updated: true });
      } else {
        const variantId = randomUUID();
        const variantInsertText = `
          INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            vendormrp, vendorsaleprice, price, mrp, tax, tax1, tax2, tax3,
            stock, weight, attributes, images, variant_color, variant_size,
            normalized_size, normalized_color, country_of_origin, is_active, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
            $20,$21,$22,$23,$24,$25, now(), now()
          )
        `;

        await client.query(variantInsertText, [
          variantId,
          BRANDS_GATEWAY_VENDOR_ID,
          productId,
          v.sku || null,
          v.barcode || null,
          v.vendor_product_id || null,
          null,
          v.vendormrp || null,
          v.vendorsaleprice || null,
          v.price || null,
          v.mrp || null,
          null,
          null,
          null,
          null,
          v.stock || 0,
          v.weight || null,
          toJsonb(v.attributes || null),
          toJsonb(v.images || null),
          v.variant_color || null,
          v.variant_size || null,
          v.normalized_size || null,
          v.normalized_color || null,
          v.country_of_origin || null,
          v.is_active !== undefined ? v.is_active : true,
        ]);
        createdVariants.push({ id: variantId, sku: v.sku, created: true });
      }
    }

    await client.query("COMMIT");
    return { productId, variants: createdVariants };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function syncBrandsgatewayProducts(jobId) {
  const client = await pool.connect();
  const syncedProductIds = new Set();
  let totalFetched = 0;
  let successCount = 0;
  let errorCount = 0;
  let page = 1;
  const perPage = 100;
  const concurrency = 4;
  const PLimit = await getPLimit();
  const limiter = PLimit(concurrency);
  const pageDelayMs = 1100;

  const marginConfig = await getMarginSettings(client, BRANDS_GATEWAY_VENDOR_ID);

  try {
    while (true) {
      const { items, total, totalPages } = await fetchProductsPage({
        storeId: STORE_ID,
        page,
        perPage,
        stockStatus: "instock",
        conditionId: "71354",
      });

      logger.info(
        { page, count: items?.length || 0, total, totalPages },
        "📦 Brandsgateway products page fetched"
      );

      if (!items || items.length === 0) {
        break;
      }

      if (page === 1 && jobId) {
        await dbPool.query(
          `UPDATE vendor_sync_jobs SET total_products = $1, updated_at = now() WHERE id = $2`,
          [total, jobId]
        );
      }

      const tasks = items.map((product, index) =>
        limiter(async () => {
          try {
            if (index % 10 === 0) {
              logger.info(
                { product_id: product?.id || null, page, index },
                "🔎 Processing Brandsgateway product"
              );
            }
            const transformed = await transformBrandsgatewayProduct(product, marginConfig);
            if (!transformed) return;
            if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) return;
            if (require("../kidsProductFilter").isKidsProduct(transformed.product)) return;
            const result = await upsertProductAndVariants(client, transformed);
            if (result && result.skipped) return;
            syncedProductIds.add(String(product.id));
            totalFetched += 1;
            successCount += 1;
            if (totalFetched % 25 === 0) {
              logger.info(
                { processed: totalFetched, successCount, errorCount },
                "📊 Brandsgateway sync progress"
              );
            }
          } catch (err) {
            errorCount += 1;
            logger.error(
              { err: err.message || err, product_id: product?.id || null },
              "Brandsgateway sync error"
            );
          }
        })
      );

      await Promise.allSettled(tasks);

      if (jobId) {
        await dbPool.query(
          `UPDATE vendor_sync_jobs SET processed_products = $1, successful_products = $2, failed_products = $3, updated_at = now() WHERE id = $4`,
          [totalFetched, successCount, errorCount, jobId]
        );
      }

      logger.info(
        { page, processed: totalFetched, successCount, errorCount },
        "✅ Brandsgateway page completed"
      );

      page += 1;
      if (totalPages && page > totalPages) {
        break;
      }

      if (pageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
    }

    if (syncedProductIds.size > 0) {
      const idArray = Array.from(syncedProductIds);
      await client.query(
        `UPDATE products
         SET is_active = false, updated_at = now()
         WHERE vendor_id = $1
         AND productid IS NOT NULL
         AND productid NOT IN (SELECT unnest($2::text[]))
         AND is_active = true
         AND deleted_at IS NULL`,
        [BRANDS_GATEWAY_VENDOR_ID, idArray]
      );
    }

    if (jobId) {
      await dbPool.query(
        `UPDATE vendor_sync_jobs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1`,
        [jobId]
      );
    }
  } catch (err) {
    if (jobId) {
      await dbPool.query(
        `UPDATE vendor_sync_jobs SET status = 'failed', completed_at = now(), updated_at = now(), error_message = $1 WHERE id = $2`,
        [err.message || String(err), jobId]
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getBrandsgatewayLiveStockData(productId) {
  const product = await fetchProductById(productId, STORE_ID);
  if (!product) {
    return {
      supplierProductId: String(productId),
      productName: null,
      brand: null,
      totalStock: 0,
      stockBySize: [],
      vendorPrice: { mrp: null, salePrice: null },
      productDeleted: true,
      checkedAt: new Date().toISOString(),
    };
  }

  const variations = Array.isArray(product.variations) ? product.variations : [];
  const stockBySize = [];

  if (variations.length > 0) {
    for (const variation of variations) {
      const size =
        resolveAttributeOption(variation.attributes, (name) =>
          name.includes("size")
        ) || "N/A";
      const quantity = variation.manage_stock
        ? Number(variation.stock_quantity || 0)
        : variation.in_stock
        ? 1
        : 0;

      stockBySize.push({
        size,
        quantity,
        sku: variation.sku || null,
      });
    }
  } else {
    const quantity = product.manage_stock
      ? Number(product.stock_quantity || 0)
      : product.in_stock
      ? 1
      : 0;
    stockBySize.push({
      size: "N/A",
      quantity,
      sku: product.sku || null,
    });
  }

  const totalStock = stockBySize.reduce(
    (sum, entry) => sum + (Number(entry.quantity) || 0),
    0
  );

  return {
    supplierProductId: String(productId),
    productName: product.name || null,
    brand: Array.isArray(product.brands) ? product.brands[0] : null,
    totalStock,
    stockBySize,
    vendorPrice: {
      mrp: product.regular_price ? Number(product.regular_price) : null,
      salePrice: product.sale_price ? Number(product.sale_price) : null,
    },
    productDeleted: false,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  syncBrandsgatewayProducts,
  transformBrandsgatewayProduct,
  upsertProductAndVariants,
  getBrandsgatewayLiveStockData,
};
