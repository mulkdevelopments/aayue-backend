/**
 * BDroppy product sync – transform, upsert, full sync.
 * Images only at product level; no variant-level images.
 * Fetches and uses categories and brands from BDroppy API.
 */

const { randomUUID } = require("crypto");
const dbPool = require("../../../db/dbConnection");
const { normalizeBrandName } = require("../../../utils/normalize");
const {
  getProductsExport,
  getCatalogs,
  getCategories,
  getSubcategories,
  getBrands,
} = require("./bdroppyHelper");
const { isBrandExcluded } = require("../excludedBrands");

const BDROPPY_VENDOR_ID = "a6bdd96b-0e2c-4f3e-b644-4e088b1778e0";
const PREFERRED_LOCALE = "en_US";

/** Tiered margin: >1000 → 28%, 501–1000 → 37%, else 45%. Same as other API vendors. */
function computeTieredPricing(vendorSalePrice, vendorMrp) {
  const salePrice = vendorSalePrice != null ? Number(vendorSalePrice) : null;
  const mrpPrice = vendorMrp != null ? Number(vendorMrp) : null;
  if (!salePrice || Number.isNaN(salePrice) || salePrice <= 0) {
    return { ourPrice: null, ourMrp: null };
  }
  let markupPercentage;
  if (salePrice > 1000) {
    markupPercentage = 0.28;
  } else if (salePrice >= 501) {
    markupPercentage = 0.37;
  } else {
    markupPercentage = 0.45;
  }
  const ourPrice = Math.round(salePrice * (1 + markupPercentage));
  let ourMrp = ourPrice;
  if (mrpPrice && Number(mrpPrice) > salePrice) {
    const vendorDiscount = (Number(mrpPrice) - salePrice) / Number(mrpPrice);
    ourMrp = Math.round(ourPrice / (1 - vendorDiscount));
  }
  return { ourPrice, ourMrp };
}

function toJsonb(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Extract text from BDroppy descriptions (can be object keyed by locale).
 */
function getDescriptionText(descriptions, locale = PREFERRED_LOCALE) {
  if (!descriptions || typeof descriptions !== "object") return null;
  const text = descriptions[locale] ?? descriptions.en_US ?? descriptions.en_EN ?? Object.values(descriptions)[0];
  if (typeof text === "string") return text.trim() || null;
  return null;
}

/**
 * Product-level images only (from pictures array). No variant images.
 * Builds full URLs using imgBase from export response root (API returns relative paths).
 */
function getProductImageUrls(pictures, imgBase) {
  if (!Array.isArray(pictures)) return [];
  const base = imgBase ? imgBase.replace(/\/$/, "") : "";
  const urls = pictures
    .map((p) => {
      if (!p || typeof p.url !== "string" || p.url === "true") return null;
      const path = p.url.replace(/^\//, "");
      if (!path) return null;
      return base ? `${base}/${path}` : p.url;
    })
    .filter(Boolean);
  return urls.slice(0, 6); // product_img + product_img1..5
}

/**
 * Resolve default_category_id from our categories by slug (from tag value).
 */
async function resolveDefaultCategoryBySlug(client, slug) {
  if (!slug || typeof slug !== "string") return null;
  const s = String(slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  if (!s) return null;
  const res = await client.query(
    `SELECT id FROM categories WHERE slug = $1 AND is_our_category = true AND deleted_at IS NULL LIMIT 1`,
    [s]
  );
  return res.rowCount ? res.rows[0].id : null;
}

/**
 * Get category/subcategory codes from product tags for product_meta.
 */
function getCategoryFromTags(tags) {
  if (!Array.isArray(tags)) return { categoryCode: null, subcategoryCode: null };
  let categoryCode = null;
  let subcategoryCode = null;
  for (const t of tags) {
    const name = (t && t.name || "").toLowerCase();
    const value = t && t.value && (t.value.value ?? t.value);
    if (!value) continue;
    const code = typeof value === "string" ? value : null;
    if (name === "category") categoryCode = code || categoryCode;
    if (name === "subcategory") subcategoryCode = code || subcategoryCode;
  }
  return { categoryCode, subcategoryCode };
}

/**
 * Transform one BDroppy API product into our product + variants shape.
 * All images on product only; variants have no images.
 * @param {Object} raw - BDroppy product from export
 * @param {string} [imgBase] - Base URL for images from export response root (pictures are relative)
 */
function transformBdroppyProduct(raw, imgBase) {
  if (!raw || (raw.type !== "P" && raw.type !== undefined)) return null;

  const productId = raw.id != null ? String(raw.id) : null;
  if (!productId) return null;

  const descriptions = raw.descriptions || raw.secondDescriptions || {};
  const description = getDescriptionText(descriptions) || getDescriptionText(raw.secondDescriptions);
  const shortDescription = description ? description.slice(0, 500) : null;

  const imageUrls = getProductImageUrls(raw.pictures, imgBase);

  const models = Array.isArray(raw.models) ? raw.models : [];
  const variants = [];

  if (models.length > 0) {
    for (const m of models) {
      const vendorVariantId = m.id != null ? String(m.id) : null;
      const sku = vendorVariantId
        ? `bdroppy_${productId}_${vendorVariantId}`
        : `bdroppy_${productId}_${randomUUID().slice(0, 8)}`;

      const sellPrice = m.sellPrice != null ? Number(m.sellPrice) : (raw.sellPrice != null ? Number(raw.sellPrice) : null);
      const streetPrice = m.streetPrice != null ? Number(m.streetPrice) : (raw.streetPrice != null ? Number(raw.streetPrice) : null);
      const vendorSale = sellPrice != null ? sellPrice : streetPrice;
      const vendorMrp = streetPrice;
      const { ourPrice, ourMrp } = computeTieredPricing(vendorSale, vendorMrp);

      variants.push({
        sku,
        vendor_product_id: vendorVariantId,
        barcode: m.barcode ? String(m.barcode) : null,
        price: ourPrice != null ? ourPrice : vendorSale,
        mrp: ourMrp != null ? ourMrp : vendorMrp,
        vendormrp: streetPrice,
        vendorsaleprice: sellPrice,
        stock: m.availability != null ? Math.max(0, parseInt(m.availability, 10)) : (raw.availability != null ? Math.max(0, parseInt(raw.availability, 10)) : 0),
        variant_color: m.color ? String(m.color).trim() : null,
        variant_size: (m.size || m.model) ? String(m.size || m.model).trim() : null,
        attributes: m.attributes || null,
        images: null,
        country_of_origin: raw.madein ? String(raw.madein).trim() : null,
        is_active: true,
      });
    }
  } else {
    const sellPrice = raw.sellPrice != null ? Number(raw.sellPrice) : null;
    const streetPrice = raw.streetPrice != null ? Number(raw.streetPrice) : null;
    const vendorSale = sellPrice || streetPrice;
    const vendorMrp = streetPrice;
    const { ourPrice, ourMrp } = computeTieredPricing(vendorSale, vendorMrp);
    variants.push({
      sku: `bdroppy_${productId}`,
      vendor_product_id: productId,
      barcode: null,
      price: ourPrice != null ? ourPrice : vendorSale,
      mrp: ourMrp != null ? ourMrp : vendorMrp,
      vendormrp: streetPrice,
      vendorsaleprice: sellPrice,
      stock: raw.availability != null ? Math.max(0, parseInt(raw.availability, 10)) : 0,
      variant_color: null,
      variant_size: null,
      attributes: raw.attributes || null,
      images: null,
      country_of_origin: raw.madein ? String(raw.madein).trim() : null,
      is_active: true,
    });
  }

  const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const product = {
    productid: productId,
    product_sku: `bdroppy_${productId}`,
    name: (raw.name && String(raw.name).trim()) || "Untitled",
    title: (raw.name && String(raw.name).trim()) || null,
    short_description: shortDescription,
    description: description,
    brand_name: raw.brand ? String(raw.brand).trim() : null,
    country_of_origin: raw.madein ? String(raw.madein).trim() : null,
    product_img: imageUrls[0] || null,
    product_img1: imageUrls[1] || null,
    product_img2: imageUrls[2] || null,
    product_img3: imageUrls[3] || null,
    product_img4: imageUrls[4] || null,
    product_img5: imageUrls[5] || null,
    attributes: raw.attributes || null,
    product_meta: {
      bdroppy_currency: raw.currency || null,
      bdroppy_rule_id: raw.ruleId || null,
      ...getCategoryFromTags(raw.tags || []),
    },
    is_active: raw.online !== false && totalStock > 0,
    gender: (raw.attributes && raw.attributes.gender) ? String(raw.attributes.gender) : null,
  };

  const { categoryCode } = getCategoryFromTags(raw.tags || []);
  return {
    product,
    variants,
    category_code: categoryCode,
  };
}

/**
 * Upsert one product and its variants. Category resolved by slug from tag.
 */
async function upsertProductAndVariants(client, transformed) {
  await client.query("BEGIN");
  try {
    const { product, variants = [], category_code } = transformed;
    let defaultCategoryId = null;
    if (category_code) {
      defaultCategoryId = await resolveDefaultCategoryBySlug(client, category_code);
    }
    if (product.product_meta && defaultCategoryId) {
      product.product_meta.default_category_resolved = defaultCategoryId;
    }

    let existing = null;
    if (product.productid) {
      const res = await client.query(
        `SELECT id, default_category_id FROM products WHERE productid = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.productid, BDROPPY_VENDOR_ID]
      );
      if (res.rowCount) existing = res.rows[0];
    }
    if (!existing && product.product_sku) {
      const res = await client.query(
        `SELECT id, default_category_id FROM products WHERE product_sku = $1 AND vendor_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [product.product_sku, BDROPPY_VENDOR_ID]
      );
      if (res.rowCount) existing = res.rows[0];
    }

    let productId = existing ? existing.id : randomUUID();

    if (existing) {
      await client.query(
        `UPDATE products SET
          name = $1, title = $2, short_description = $3, description = $4,
          brand_name = $5, brand_name_normalized = $6, product_sku = $7, gender = $8,
          default_category_id = COALESCE($9, default_category_id),
          attributes = $10::jsonb, product_meta = $11::jsonb,
          product_img = $12, product_img1 = $13, product_img2 = $14, product_img3 = $15, product_img4 = $16, product_img5 = $17,
          supplier = $18, country_of_origin = $19, is_active = $20, updated_at = now()
        WHERE id = $21`,
        [
          product.name,
          product.title,
          product.short_description,
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
          null,
          product.country_of_origin,
          product.is_active !== undefined ? product.is_active : true,
          productId,
        ]
      );
    } else {
      await client.query(
        `INSERT INTO products (
          id, vendor_id, productid, product_sku, name, title, short_description, description,
          brand_name, brand_name_normalized, gender, default_category_id, attributes, product_meta,
          product_img, product_img1, product_img2, product_img3, product_img4, product_img5,
          cod_available, country_of_origin, is_active, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,
          $15,$16,$17,$18,$19,$20, false, $21, $22, now(), now()
        ) RETURNING id`,
        [
          productId,
          BDROPPY_VENDOR_ID,
          product.productid,
          product.product_sku,
          product.name,
          product.title,
          product.short_description,
          product.description,
          product.brand_name,
          normalizeBrandName(product.brand_name),
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
          product.country_of_origin,
          product.is_active !== undefined ? product.is_active : true,
        ]
      );
    }

    for (const v of variants) {
      // Match variant by vendor_product_id; accept both "709880" and "709880.0" (CSV import may store .0)
      const variantLookup = v.vendor_product_id
        ? await client.query(
            `SELECT id FROM product_variants
             WHERE product_id = $1 AND deleted_at IS NULL
             AND (vendor_product_id = $2 OR vendor_product_id = $2 || '.0')
             LIMIT 1`,
            [productId, v.vendor_product_id]
          )
        : await client.query(
            `SELECT id FROM product_variants WHERE sku = $1 AND product_id = $2 AND deleted_at IS NULL`,
            [v.sku, productId]
          );

      if (variantLookup.rowCount) {
        const vid = variantLookup.rows[0].id;
        await client.query(
          `UPDATE product_variants SET
            vendor_id = $1, sku = $2, vendor_product_id = $3, vendormrp = $4, vendorsaleprice = $5,
            mrp = $6, price = $7, stock = $8, attributes = $9::jsonb, variant_color = $10, variant_size = $11,
            barcode = $12, country_of_origin = $13, is_active = $14, updated_at = now()
          WHERE id = $15`,
          [
            BDROPPY_VENDOR_ID,
            v.sku,
            v.vendor_product_id,
            v.vendormrp,
            v.vendorsaleprice,
            v.mrp,
            v.price,
            v.stock ?? 0,
            toJsonb(v.attributes),
            v.variant_color,
            v.variant_size,
            v.barcode,
            v.country_of_origin,
            v.is_active !== undefined ? v.is_active : true,
            vid,
          ]
        );
      } else {
        const variantId = randomUUID();
        await client.query(
          `INSERT INTO product_variants (
            id, vendor_id, product_id, sku, barcode, vendor_product_id, vendormrp, vendorsaleprice, price, mrp,
            stock, attributes, variant_color, variant_size, country_of_origin, is_active, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,now(),now())`,
          [
            variantId,
            BDROPPY_VENDOR_ID,
            productId,
            v.sku,
            v.barcode,
            v.vendor_product_id,
            v.vendormrp,
            v.vendorsaleprice,
            v.price,
            v.mrp,
            v.stock ?? 0,
            toJsonb(v.attributes),
            v.variant_color,
            v.variant_size,
            v.country_of_origin,
            v.is_active !== undefined ? v.is_active : true,
          ]
        );
      }
    }

    await client.query("COMMIT");
    return { productId, variantCount: variants.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Full sync: fetch categories/brands (for reference), then paginate export and upsert.
 */
async function syncBdroppyProducts(jobId) {
  const client = await dbPool.connect();
  const syncedProductIds = new Set();
  let totalFetched = 0;
  let successCount = 0;
  let errorCount = 0;
  let page = 1;
  const pageSize = 100;

  let userCatalog = process.env.BDROPPY_USER_CATALOG || null;
  if (!userCatalog) {
    try {
      const catalogs = await getCatalogs();
      const first = catalogs[0];
      if (first && (first._id || first.id)) {
        userCatalog = String(first._id || first.id);
      }
    } catch (e) {
      console.warn("BDroppy: could not fetch catalogs, using env BDROPPY_USER_CATALOG only:", e.message);
    }
  }

  if (!userCatalog) {
    if (jobId) {
      await dbPool.query(
        `UPDATE vendor_sync_jobs SET status = 'failed', completed_at = now(), updated_at = now(), error_message = $1 WHERE id = $2`,
        ["BDROPPY_USER_CATALOG not set and no catalogs returned", jobId]
      );
    }
    client.release();
    throw new Error("BDROPPY_USER_CATALOG not set and no catalogs returned");
  }

  try {
    // Fetch categories and brands (for reference / future mapping)
    let categoriesCount = 0;
    let subcategoriesCount = 0;
    let brandsCount = 0;
    try {
      const [categories, subcategories, brands] = await Promise.all([
        getCategories(),
        getSubcategories(),
        getBrands(),
      ]);
      categoriesCount = categories.length;
      subcategoriesCount = subcategories.length;
      brandsCount = brands.length;
      console.log(`📂 BDroppy: loaded ${categoriesCount} categories, ${subcategoriesCount} subcategories, ${brandsCount} brands`);
    } catch (e) {
      console.warn("BDroppy: optional categories/brands fetch failed:", e.message);
    }

    while (true) {
      const { items, imgBase } = await getProductsExport({
        userCatalog,
        page,
        pageSize,
        acceptedlocales: PREFERRED_LOCALE,
      });

      if (!items || items.length === 0) break;

      if (page === 1 && jobId) {
        await dbPool.query(
          `UPDATE vendor_sync_jobs SET total_products = $1, updated_at = now() WHERE id = $2`,
          [pageSize, jobId]
        );
      }

      for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        try {
          const transformed = transformBdroppyProduct(raw, imgBase);
          if (!transformed) continue;
          if (isBrandExcluded(transformed.product.brand_name)) continue;
          await upsertProductAndVariants(client, transformed);
          syncedProductIds.add(String(raw.id));
          successCount += 1;
        } catch (err) {
          errorCount += 1;
          console.error(`BDroppy sync error product id=${raw?.id}:`, err.message);
        }
        totalFetched += 1;
      }

      if (jobId) {
        await dbPool.query(
          `UPDATE vendor_sync_jobs SET processed_products = $1, successful_products = $2, failed_products = $3, updated_at = now() WHERE id = $4`,
          [totalFetched, successCount, errorCount, jobId]
        );
      }

      if (items.length < pageSize) break;
      page += 1;
      await new Promise((r) => setTimeout(r, 400));
    }

    if (syncedProductIds.size > 0) {
      const idArray = Array.from(syncedProductIds);
      await client.query(
        `UPDATE products SET is_active = false, updated_at = now()
         WHERE vendor_id = $1 AND productid IS NOT NULL
         AND productid NOT IN (SELECT unnest($2::text[]))
         AND is_active = true AND deleted_at IS NULL`,
        [BDROPPY_VENDOR_ID, idArray]
      );
    }

    if (jobId) {
      await dbPool.query(
        `UPDATE vendor_sync_jobs SET status = 'completed', total_products = $1, completed_at = now(), updated_at = now() WHERE id = $2`,
        [totalFetched, jobId]
      );
    }

    console.log(`✅ BDroppy sync done: ${successCount} ok, ${errorCount} failed`);
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

module.exports = {
  transformBdroppyProduct,
  upsertProductAndVariants,
  syncBdroppyProducts,
  BDROPPY_VENDOR_ID,
};
