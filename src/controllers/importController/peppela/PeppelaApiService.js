const { randomUUID } = require("crypto");
const pino = require("pino");
const dbPool = require("../../../db/dbConnection");
const {
  fetchProductsPage,
  fetchProductById,
  fetchCombinationDetails,
  fetchStockById,
  fetchOptionValueById,
  fetchProductFeatureById,
  fetchProductFeatureValueById,
  fetchCategoryById,
  buildImageUrl,
  normalizeToArray,
} = require("./peppelaHelper");
const { toJsonb, slugify } = require("../../../../importHelpers");
const { normalizeBrandName } = require("../../../utils/normalize");
const { normalizeSize } = require("../../../utils/normalizeSize");
const { categoryHintFromPath } = require("../../../utils/sizeConversion");
const { getMarginSettings, computeTieredPricing } = require("../../../utils/marginHelper");

const logger = pino({ level: process.env.IMPORT_LOG_LEVEL || "info" });

const PEPPELA_VENDOR_ID = "b34fd0f6-815a-469e-b7c2-73f9e8afb3ed";

const optionValueCache = new Map();
const categoryCache = new Map();
const featureCache = new Map();
const featureValueCache = new Map();
let pLimitFn = null;

async function getPLimit() {
  if (pLimitFn) return pLimitFn;
  const mod = await import("p-limit");
  pLimitFn = mod.default || mod;
  return pLimitFn;
}

function normalizeName(name) {
  if (!name) return null;
  if (typeof name === "string") return name;
  if (Array.isArray(name)) return name[0];
  if (typeof name === "object") {
    const firstValue = Object.values(name)[0];
    return typeof firstValue === "string" ? firstValue : null;
  }
  return null;
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

function inferGenderFromCategory(categoryPath, productName) {
  const haystack = `${categoryPath || ""} ${productName || ""}`.toLowerCase();
  if (!haystack.trim()) return null;

  if (haystack.includes("women") || haystack.includes("woman") || haystack.includes("ladies")) {
    return "women";
  }
  if (haystack.includes("men") || haystack.includes("man") || haystack.includes("mens")) {
    return "men";
  }
  if (haystack.includes("girls")) return "girls";
  if (haystack.includes("boys")) return "boys";
  if (haystack.includes("kids") || haystack.includes("children")) return "kids";
  if (haystack.includes("unisex")) return "unisex";
  return null;
}

function inferSeasonsFromCategory(categoryPath, productName) {
  const haystack = `${categoryPath || ""} ${productName || ""}`.toLowerCase();
  if (!haystack.trim()) return { season_one: null, season_two: null };

  const seasonMap = [
    { key: "spring/summer", value: "spring/summer" },
    { key: "spring summer", value: "spring/summer" },
    { key: "ss", value: "spring/summer" },
    { key: "summer", value: "summer" },
    { key: "spring", value: "spring" },
    { key: "fall/winter", value: "fall/winter" },
    { key: "fall winter", value: "fall/winter" },
    { key: "autumn/winter", value: "fall/winter" },
    { key: "fw", value: "fall/winter" },
    { key: "winter", value: "winter" },
    { key: "autumn", value: "autumn" },
    { key: "fall", value: "fall" },
  ];

  const hits = [];
  for (const entry of seasonMap) {
    if (haystack.includes(entry.key)) {
      if (!hits.includes(entry.value)) hits.push(entry.value);
    }
  }

  return {
    season_one: hits[0] || null,
    season_two: hits[1] || null,
  };
}

async function getOptionValue(optionValueId) {
  if (optionValueCache.has(optionValueId)) {
    return optionValueCache.get(optionValueId);
  }
  const data = await fetchOptionValueById(optionValueId);
  if (data) {
    optionValueCache.set(optionValueId, data);
  }
  return data;
}

async function getCategory(categoryId) {
  if (categoryCache.has(categoryId)) {
    return categoryCache.get(categoryId);
  }
  const data = await fetchCategoryById(categoryId);
  if (data) {
    categoryCache.set(categoryId, data);
  }
  return data;
}

async function getProductFeature(featureId) {
  if (featureCache.has(featureId)) {
    return featureCache.get(featureId);
  }
  const data = await fetchProductFeatureById(featureId);
  if (data) {
    featureCache.set(featureId, data);
  }
  return data;
}

async function getProductFeatureValue(featureValueId) {
  if (featureValueCache.has(featureValueId)) {
    return featureValueCache.get(featureValueId);
  }
  const data = await fetchProductFeatureValueById(featureValueId);
  if (data) {
    featureValueCache.set(featureValueId, data);
  }
  return data;
}

async function buildCategoryPath(categoryId) {
  const parts = [];
  let currentId = categoryId;

  while (currentId && currentId !== "1" && currentId !== "2") {
    const category = await getCategory(currentId);
    if (!category) break;
    const name = normalizeName(category.name);
    if (name) {
      parts.unshift(name);
    }
    const parent = category.id_parent ? String(category.id_parent) : null;
    if (!parent || parent === currentId) break;
    currentId = parent;
  }

  return parts.length ? parts.join(" > ") : null;
}

async function ensureCategoryPath(client, categoryPath) {
  if (!categoryPath) return null;
  const parts = categoryPath
    .split(/->|\/|>/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  let parentId = null;
  let parentPath = null;

  for (const part of parts) {
    const slug = slugify(part);
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
      [id, PEPPELA_VENDOR_ID, part, slug, parentId, currentPath, JSON.stringify(metadata)]
    );

    parentId = rows[0].id;
    parentPath = currentPath;
  }

  return parentId;
}

async function transformPeppelaProduct(product, marginConfig) {
  const transformStart = Date.now();
  const productId = String(product.id);
  const name = normalizeName(product.name);
  const description = normalizeName(product.description);
  const productSku = product.reference ? String(product.reference) : null;
  const brandName = product.manufacturer_name || null;

  const imageIds = normalizeToArray(product.associations?.images);
  const imageUrls = imageIds
    .map((img) => img?.id)
    .filter(Boolean)
    .map((id) => buildImageUrl(productId, id));

  const categoryIds = normalizeToArray(product.associations?.categories)
    .map((cat) => cat?.id)
    .filter(Boolean)
    .map((id) => String(id));

  let categoryPath = null;
  if (categoryIds.length > 0) {
    const paths = await Promise.all(categoryIds.map((id) => buildCategoryPath(id)));
    categoryPath = paths.filter(Boolean).sort((a, b) => b.length - a.length)[0] || null;
  }

  const inferredGender = inferGenderFromCategory(categoryPath, name);
  const inferredSeasons = inferSeasonsFromCategory(categoryPath, name);

  const featureEntries = normalizeToArray(product.associations?.product_features)
    .map((entry) => ({
      featureId: entry?.id ? String(entry.id) : null,
      valueId: entry?.id_feature_value ? String(entry.id_feature_value) : null,
    }))
    .filter((entry) => entry.featureId && entry.valueId);

  const featurePairs = [];
  for (const entry of featureEntries) {
    const feature = await getProductFeature(entry.featureId);
    const featureValue = await getProductFeatureValue(entry.valueId);
    if (!feature || !featureValue) continue;
    const featureName = normalizeName(feature.name);
    const value =
      normalizeName(featureValue.value) ||
      normalizeName(featureValue.name) ||
      null;
    if (!featureName || !value) continue;
    featurePairs.push({
      id: entry.featureId,
      name: featureName,
      value,
      value_id: entry.valueId,
    });
  }

  const featureMap = {};
  let featureGender = null;
  let featureMaterial = null;
  let featureMadeIn = null;
  const featureSeasons = [];
  for (const pair of featurePairs) {
    const key = String(pair.name).toLowerCase();
    featureMap[key] = pair.value;
    if (key.includes("gender")) {
      featureGender = pair.value;
    }
    if (key.includes("season")) {
      if (!featureSeasons.includes(pair.value)) {
        featureSeasons.push(pair.value);
      }
    }
    if (key.includes("material") || key.includes("composition")) {
      featureMaterial = pair.value;
    }
    if (key.includes("made in") || key.includes("made_in")) {
      featureMadeIn = pair.value;
    }
  }

  const finalGender = normalizeGenderValue(featureGender) || inferredGender;
  const finalSeasonOne = featureSeasons[0] || inferredSeasons.season_one;
  const finalSeasonTwo = featureSeasons[1] || inferredSeasons.season_two;

  const productMeta = {
    vendor_price: product.price ? Number(product.price) : null,
    wholesale_price: product.wholesale_price ? Number(product.wholesale_price) : null,
    street_price: product.street_price ? Number(product.street_price) : null,
    product_type: product.product_type || null,
    id_default_image: product.id_default_image || null,
    vendor_reference: product.reference ? String(product.reference) : null,
    vendor_active: product.active === "1",
    weight: product.weight ? Number(product.weight) : null,
    width: product.width ? Number(product.width) : null,
    height: product.height ? Number(product.height) : null,
    depth: product.depth ? Number(product.depth) : null,
    season_one: finalSeasonOne,
    season_two: finalSeasonTwo,
    material: featureMaterial || null,
    made_in: featureMadeIn || null,
    product_features: featurePairs,
    product_feature_map: featureMap,
  };

  const baseVariantPrice = product.price ? Number(product.price) : null;
  if (baseVariantPrice !== null && baseVariantPrice < 6) {
    return null;
  }
  const baseVariantMrp = product.street_price ? Number(product.street_price) : null;
  const { ourPrice, ourMrp } = computeTieredPricing(baseVariantPrice, baseVariantMrp, marginConfig);

  const combinationIds = normalizeToArray(product.associations?.combinations)
    .map((combo) => combo?.id)
    .filter(Boolean)
    .map((id) => String(id));

  const stockEntries = normalizeToArray(product.associations?.stock_availables)
    .map((entry) => ({
      id: entry?.id ? String(entry.id) : null,
      attributeId: entry?.id_product_attribute ? String(entry.id_product_attribute) : "0",
    }))
    .filter((entry) => entry.id);

  const variants = [];

  for (const combinationId of combinationIds) {
    const combination = await fetchCombinationDetails(combinationId);
    const optionValueIds = combination.optionValueIds || [];

    let variantSize = null;
    let variantColor = null;

    for (const optionValueId of optionValueIds) {
      const optionValue = await getOptionValue(optionValueId);
      if (!optionValue) continue;

      const groupId = String(optionValue.id_attribute_group || "");
      const valueName = normalizeName(optionValue.name);

      if (groupId === "1") {
        variantSize = valueName || variantSize;
      } else if (groupId === "2" || groupId === "6") {
        variantColor = valueName || variantColor;
      }
    }

    const stockEntry = stockEntries.find(
      (entry) => entry.attributeId === combinationId
    );
    let stockQty = 0;
    if (stockEntry?.id) {
      const stock = await fetchStockById(stockEntry.id);
      stockQty = stock?.quantity ? Number(stock.quantity) : 0;
    }

    const _catH = categoryHintFromPath(categoryPath);
    const _genH = inferredGender || null;
    const _sz = normalizeSize(variantSize, _catH, _genH);

    variants.push({
      sku: combination.reference || `${productSku}-${combinationId}`,
      vendor_product_id: combinationId,
      variant_size: variantSize,
      variant_color: variantColor,
      normalized_size: variantSize,
      normalized_size_final: _sz.canonical || variantSize,
      normalized_color: variantColor,
      size_type: _sz.sizeType || null,
      stock: stockQty,
      vendormrp: baseVariantMrp,
      vendorsaleprice: baseVariantPrice,
      price: ourPrice,
      mrp: ourMrp,
      images: imageUrls,
      attributes: {
        size: variantSize,
        color: variantColor,
      },
      is_active: true,
    });
  }

  let totalStock = variants.reduce(
    (sum, variant) => sum + (Number(variant.stock) || 0),
    0
  );
  if (totalStock === 0 && variants.length === 0 && stockEntries.length > 0) {
    const baseStockEntry = stockEntries.find(
      (entry) => entry.attributeId === "0"
    );
    if (baseStockEntry?.id) {
      const stock = await fetchStockById(baseStockEntry.id);
      totalStock = stock?.quantity ? Number(stock.quantity) : 0;
    }
  }
  const isActiveByStock = totalStock > 0;

  logger.info(
    {
      product_id: productId,
      product_sku: productSku,
      combination_count: combinationIds.length,
      variant_count: variants.length,
      stock_entries: stockEntries.length,
      image_count: imageUrls.length,
      category_count: categoryIds.length,
      category_path: categoryPath,
      gender: finalGender,
      country_of_origin: featureMadeIn || null,
      took_ms: Date.now() - transformStart,
    },
    "🧩 Transformed Peppela product"
  );

  const productPayload = {
    productid: productId,
    product_sku: productSku,
    name: name || "",
    title: name || "",
    short_description: null,
    description: description || null,
    brand_name: brandName,
    gender: finalGender,
    attributes: {
      brand: brandName,
      gender: finalGender,
      season_one: finalSeasonOne,
      season_two: finalSeasonTwo,
      category_path: categoryPath,
      material: featureMaterial || null,
    },
    product_meta: productMeta,
    product_img: imageUrls[0] || null,
    product_img1: imageUrls[0] || null,
    product_img2: imageUrls[1] || null,
    product_img3: imageUrls[2] || null,
    product_img4: imageUrls[3] || null,
    product_img5: imageUrls[4] || null,
    supplier: brandName,
    country_of_origin: featureMadeIn || null,
    is_active: product.active === "1" && isActiveByStock,
  };

  return { product: productPayload, variants, category_path: categoryPath };
}

async function upsertProductAndVariants(client, transformed) {
  const upsertStart = Date.now();
  await client.query("BEGIN");
  try {
    const { product, variants = [], category_path } = transformed;
    let defaultCategoryId = null;

    if (category_path) {
      defaultCategoryId = await ensureCategoryPath(client, category_path);
    }
    logger.info(
      {
        product_id: product.productid,
        product_sku: product.product_sku,
        category_path,
        default_category_id: defaultCategoryId,
        gender: product.gender || null,
        country_of_origin: product.country_of_origin || null,
      },
      "🧷 Peppela category + metadata resolved"
    );

    let existing = null;
    if (product.productid) {
      const res = await client.query(
        `SELECT id, default_category_id, manually_edited_at FROM products WHERE productid = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.productid, PEPPELA_VENDOR_ID]
      );
      if (res.rowCount) existing = res.rows[0];
    }

    if (!existing && product.product_sku) {
      const res = await client.query(
        `SELECT id, default_category_id, manually_edited_at FROM products WHERE product_sku = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.product_sku, PEPPELA_VENDOR_ID]
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
        [product.productid, PEPPELA_VENDOR_ID]
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
        PEPPELA_VENDOR_ID,
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
              normalized_size_final = $15,
              size_type = $16,
              updated_at = now()
            WHERE id = $17
          `,
          [
            PEPPELA_VENDOR_ID,
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
            v.normalized_size_final || v.normalized_size || null,
            v.size_type || null,
            vid,
          ]
        );
        createdVariants.push({ id: vid, sku: v.sku, updated: true });
      } else {
        const variantId = randomUUID();
        const insertVariantSql = `
          INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, productpartnersku,
            price, mrp, stock, weight, dimension, length, width, height,
            attributes, images, image_urls, video1, video2, vendormrp, vendorsaleprice,
            tax, tax1, tax2, tax3, variant_color, variant_size,
            country_of_origin, is_active, normalized_size, normalized_color, size_type,
            normalized_size_final, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12::jsonb,$13,$14,$15,
            $16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,
            $23::jsonb,$24,$25,$26,$27,$28,
            $29,$30,$31,$32,$33,$34, now(), now()
          ) RETURNING id
        `;

        const vals = [
          variantId,
          PEPPELA_VENDOR_ID,
          productId,
          v.sku,
          null,
          v.vendor_product_id || null,
          null,
          v.price || null,
          v.mrp || null,
          v.stock || 0,
          null,
          null,
          null,
          null,
          null,
          toJsonb(v.attributes || null),
          toJsonb(v.images || null),
          null,
          null,
          null,
          v.vendormrp || null,
          v.vendorsaleprice || null,
          null,
          null,
          null,
          null,
          v.variant_color || null,
          v.variant_size || null,
          null,
          true,
          v.normalized_size || null,
          v.normalized_color || null,
          v.size_type || null,
          v.normalized_size_final || v.normalized_size || null,
        ];

        const inserted = await client.query(insertVariantSql, vals);
        createdVariants.push({ id: inserted.rows[0].id, sku: v.sku, created: true });

        if (v.stock && Number(v.stock) > 0) {
          await client.query(
            `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
             VALUES ($1,$2,$3,$4,$5, now())`,
            [randomUUID(), inserted.rows[0].id, v.stock, "initial_import_peppela", null]
          );
        }
      }
    }

    if (defaultCategoryId) {
      const exists = await client.query(
        "SELECT id FROM product_categories WHERE product_id = $1 AND category_id = $2 AND deleted_at IS NULL",
        [productId, defaultCategoryId]
      );
      if (exists.rowCount === 0) {
        await client.query(
          "INSERT INTO product_categories (id, product_id, category_id, vendor_id) VALUES ($1,$2,$3,$4)",
          [randomUUID(), productId, defaultCategoryId, PEPPELA_VENDOR_ID]
        );
        logger.info(
          {
            product_id: product.productid,
            category_id: defaultCategoryId,
          },
          "🗂️ Linked Peppela product to category"
        );
      }
    }

    const dyns = [];
    if (product.brand_name) {
      dyns.push({ filter_type: "brand", filter_name: product.brand_name });
    }
    const firstVar = variants[0] || {};
    if (firstVar.variant_color) {
      dyns.push({ filter_type: "color", filter_name: firstVar.variant_color });
    }
    if (firstVar.variant_size) {
      dyns.push({ filter_type: "size", filter_name: firstVar.variant_size });
    }

    for (const df of dyns) {
      const ex = await client.query(
        "SELECT id FROM product_dynamic_filters WHERE product_id = $1 AND filter_type = $2 AND filter_name = $3 AND deleted_at IS NULL",
        [productId, df.filter_type, df.filter_name]
      );
      if (ex.rowCount === 0) {
        await client.query(
          "INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name, vendor_id) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), productId, df.filter_type, df.filter_name, PEPPELA_VENDOR_ID]
        );
      }
    }

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

    async function upsertMediaRow({ url, variant_id = null, type = "image", name = null, metadata = {} }) {
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
          toJsonb(Object.assign({ imported: true, product_id: productId }, metadata)),
        ]
      );
      return mediaId;
    }

    for (const v of variants) {
      const imageUrls = Array.isArray(v.images) ? v.images : [];
      if (!imageUrls.length) continue;
      const vid = skuToVariantId.get(v.sku) || null;
      for (const url of imageUrls) {
        if (!url) continue;
        await upsertMediaRow({
          url,
          variant_id: vid,
          type: "image",
          metadata: { variant_sku: v.sku },
        });
      }
    }

    const productImageUrls = [
      product.product_img,
      product.product_img1,
      product.product_img2,
      product.product_img3,
      product.product_img4,
      product.product_img5,
    ].filter(Boolean);

    for (const url of productImageUrls) {
      const { rows: already } = await client.query(
        "SELECT id FROM media WHERE url = $1 AND deleted_at IS NULL LIMIT 1",
        [url]
      );
      if (already.length > 0) continue;
      await upsertMediaRow({ url, variant_id: null, type: "image", metadata: {} });
    }

    await client.query("COMMIT");
    logger.info(
      {
        product_id: product.productid,
        product_sku: product.product_sku,
        variants: variants.length,
        took_ms: Date.now() - upsertStart,
      },
      "✅ Upserted Peppela product"
    );
    return { ok: true, productId, variants: createdVariants };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function getPeppelaLiveStockData(vendorProductId) {
  const productData = await fetchProductById(vendorProductId);
  if (!productData) {
    return {
      supplierProductId: String(vendorProductId),
      productName: null,
      brand: null,
      totalStock: 0,
      stockBySize: [],
      vendorPrice: { mrp: null, salePrice: null },
      productDeleted: true,
      checkedAt: new Date().toISOString(),
    };
  }

  const combinationIds = normalizeToArray(productData.associations?.combinations)
    .map((combo) => combo?.id)
    .filter(Boolean)
    .map((id) => String(id));

  const stockEntries = normalizeToArray(productData.associations?.stock_availables)
    .map((entry) => ({
      id: entry?.id ? String(entry.id) : null,
      attributeId: entry?.id_product_attribute ? String(entry.id_product_attribute) : "0",
    }))
    .filter((entry) => entry.id);

  const stockBySize = [];

  if (!combinationIds.length) {
    const stockEntry = stockEntries.find((entry) => entry.attributeId === "0");
    let stockQty = 0;
    if (stockEntry?.id) {
      const stock = await fetchStockById(stockEntry.id);
      stockQty = stock?.quantity ? Number(stock.quantity) : 0;
    }
    stockBySize.push({ size: "N/A", color: null, quantity: stockQty });
  } else {
    for (const combinationId of combinationIds) {
      const combination = await fetchCombinationDetails(combinationId);
      const optionValueIds = combination.optionValueIds || [];

      let variantSize = null;
      let variantColor = null;

      for (const optionValueId of optionValueIds) {
        const optionValue = await getOptionValue(optionValueId);
        if (!optionValue) continue;

        const groupId = String(optionValue.id_attribute_group || "");
        const valueName = normalizeName(optionValue.name);

        if (groupId === "1") {
          variantSize = valueName || variantSize;
        } else if (groupId === "2" || groupId === "6") {
          variantColor = valueName || variantColor;
        }
      }

      const stockEntry = stockEntries.find(
        (entry) => entry.attributeId === combinationId
      );
      let stockQty = 0;
      if (stockEntry?.id) {
        const stock = await fetchStockById(stockEntry.id);
        stockQty = stock?.quantity ? Number(stock.quantity) : 0;
      }

      stockBySize.push({
        size: variantSize || "N/A",
        color: variantColor || null,
        quantity: stockQty,
      });
    }
  }

  const totalStock = stockBySize.reduce((sum, entry) => sum + (entry.quantity || 0), 0);

  return {
    supplierProductId: String(vendorProductId),
    productName: normalizeName(productData.name),
    brand: productData.manufacturer_name || null,
    totalStock,
    stockBySize,
    vendorPrice: {
      mrp: productData.street_price ? Number(productData.street_price) : null,
      salePrice: productData.price ? Number(productData.price) : null,
    },
    checkedAt: new Date().toISOString(),
  };
}

async function syncPeppelaProducts(jobId) {
  const { VendorSyncJobService } = require("../../../services/vendorSyncJobService");

  let offset = 0;
  const limit = 100;
  const concurrency = parseInt(process.env.PEPPELA_SYNC_CONCURRENCY || "4", 10);
  const pLimit = await getPLimit();
  const limiter = pLimit(Number.isNaN(concurrency) ? 4 : concurrency);
  let totalFetched = 0;
  let successCount = 0;
  let errorCount = 0;
  let page = 1;

  const syncedProductIds = new Set();
  const client = await dbPool.connect();

  const marginConfig = await getMarginSettings(client, PEPPELA_VENDOR_ID);

  try {
    logger.info("🚀 Starting Peppela product sync...");

    while (true) {
      const shouldCancel = await VendorSyncJobService.shouldCancelJob(client, jobId);
      if (shouldCancel) {
        await VendorSyncJobService.completeSyncJob(
          client,
          jobId,
          "cancelled",
          "Cancelled by user"
        );
        break;
      }

      logger.info({ page, offset, limit }, "📄 Fetching Peppela product page");
      let list;
      try {
        list = await fetchProductsPage(offset, limit);
      } catch (err) {
        logger.error(
          { err: err.message || err, page, offset },
          "Peppela product list fetch failed"
        );
        throw err;
      }

      logger.info(
        { page, count: list?.length || 0 },
        "📦 Retrieved Peppela product page"
      );
      if (!list || list.length === 0) {
        break;
      }

      const tasks = list.map((entry, index) =>
        limiter(async () => {
          try {
            if (!entry?.id) {
              throw new Error("Product list entry missing id");
            }

            if (index % 10 === 0) {
              logger.info(
                { product_id: entry.id, page, index },
                "🔎 Processing Peppela product"
              );
            }

            const fetchStart = Date.now();
            const product = await fetchProductById(entry.id);
            logger.info(
              {
                product_id: entry.id,
                took_ms: Date.now() - fetchStart,
              },
              "📥 Fetched Peppela product detail"
            );

            const transformStart = Date.now();
            const transformed = await transformPeppelaProduct(product, marginConfig);
            if (!transformed) {
              return;
            }
            if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) {
              return;
            }
            if (require("../kidsProductFilter").isKidsProduct(transformed.product)) {
              return;
            }
            logger.info(
              {
                product_id: entry.id,
                took_ms: Date.now() - transformStart,
              },
              "🧪 Transformed Peppela product detail"
            );

            const upsertStart = Date.now();
            const result = await upsertProductAndVariants(client, transformed);
            if (result && result.skipped) return;
            logger.info(
              {
                product_id: entry.id,
                took_ms: Date.now() - upsertStart,
              },
              "💾 Saved Peppela product"
            );
            if (product?.id) {
              syncedProductIds.add(String(product.id));
            }
            totalFetched += 1;
            successCount += 1;

            if (totalFetched % 25 === 0) {
              logger.info(
                { processed: totalFetched, successCount, errorCount },
                "📊 Peppela sync progress"
              );
            }
          } catch (err) {
            errorCount += 1;
            logger.error(
              {
                err: err.message || err,
                product_id: entry?.id || null,
                responseData: err.responseData || null,
              },
              "Peppela sync error"
            );
          }
        })
      );

      await Promise.allSettled(tasks);

      await VendorSyncJobService.updateSyncProgress(client, jobId, {
        processedProducts: totalFetched,
        successfulProducts: successCount,
        failedProducts: errorCount,
        currentPage: page,
      });

      if (list.length < limit) {
        break;
      }
      offset += limit;
      page += 1;
    }

    if (syncedProductIds.size > 0) {
      const idArray = Array.from(syncedProductIds);
      const orphanResult = await client.query(
        `UPDATE products
         SET is_active = false, updated_at = now()
         WHERE vendor_id = $1
         AND productid IS NOT NULL
         AND productid NOT IN (SELECT unnest($2::text[]))
         AND is_active = true
         AND deleted_at IS NULL`,
        [PEPPELA_VENDOR_ID, idArray]
      );
      logger.info({ orphanCount: orphanResult.rowCount }, "Peppela orphan products deactivated");
    }

    await VendorSyncJobService.completeSyncJob(client, jobId, "completed");

    return {
      totalFetched,
      successCount,
      errorCount,
    };
  } catch (err) {
    await VendorSyncJobService.completeSyncJob(client, jobId, "failed", err.message, {
      stack: err.stack,
    });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  syncPeppelaProducts,
  transformPeppelaProduct,
  upsertProductAndVariants,
  getPeppelaLiveStockData,
};
