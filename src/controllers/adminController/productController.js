const catchAsync = require("../../errorHandling/catchAsync");
const ProductService = require("../../services/productService");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");
const CategoryService = require("../../services/categoryService");
const {
  rewriteDescription,
  suggestQuarantineFix,
} = require("../../services/aiDescriptionRewriteService");
const {
  PG_COMPOSITE_COLOR_SPLIT_REGEX_E,
  SQL_EXCLUDE_JUNK_COLOR_TOKEN_T,
  SQL_EXCLUDE_JUNK_VARIANT_COLOR_ONLY_PV,
  normalizeColorFilterParams,
  sqlVariantMatchesColorParams,
} = require("../../utils/colorFilterSql");
const filterCache = require("../../utils/filterCache");
const { WOMEN_CLOTHING, MEN_CLOTHING, WOMEN_SHOES, MEN_SHOES, ALPHA_SORT_ORDER } = require("../../utils/sizeConversion");

function validateCategoryIds(category_ids = []) {
  if (!Array.isArray(category_ids)) return false;
  for (const cid of category_ids) {
    if (!isValidUUID(cid)) return false;
  }
  return true;
}

module.exports.createProduct = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      product,
      variants = [],
      category_ids = [],
      dynamic_filters = [],
    } = req.body;

    if (!product || !product.name) {
      client.release();
      return next(new AppError("product.name is required", 400));
    }

    // If vendor_id provided, validate format and existence
    if (product.vendor_id) {
      if (!isValidUUID(product.vendor_id)) {
        client.release();
        return next(new AppError("Invalid vendor_id format", 400));
      }
      // check vendor exists
      const { rows: vendorRows } = await client.query(
        `SELECT id FROM vendors WHERE id = $1 AND deleted_at IS NULL`,
        [product.vendor_id]
      );
      if (vendorRows.length === 0) {
        client.release();
        return next(new AppError("Vendor not found", 404));
      }
    }

    if (!validateCategoryIds(category_ids)) {
      client.release();
      return next(new AppError("category_ids must be an array of UUIDs", 400));
    }

    // Basic variant validation
    for (const v of variants) {
      if (!v.sku) {
        client.release();
        return next(new AppError("Each variant must have a sku", 400));
      }
      if (!v.price && v.price !== 0) {
        client.release();
        return next(new AppError("Each variant must have a price", 400));
      }
    }

    await client.query("BEGIN");

    const result = await ProductService.createProduct(
      { product, variants, category_ids, dynamic_filters },
      client
    );

    await client.query("COMMIT");
    return sendResponse(res, 201, true, "Product created", result);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to create product", 500));
  } finally {
    client.release();
  }
});

/**
 * GET /api/products
 * Query params supported:
 *  - q (search string)
 *  - category_id (UUID) -> includes category subtree
 *  - brand (string)
 *  - vendor_id (uuid)
 *  - min_price, max_price (numbers)
 *  - color, size, gender, country (string)
 *  - sku (string)
 *  - dynamic_filter (multiple allowed) format: "type:name" e.g. dynamic_filter=brand:HouseBrand
 *      You can pass multiple dynamic_filter params.
 *  - sort_by = price|created_at|name (default created_at)
 *  - sort_order = asc|desc (default desc)
 *  - page (int, default 1)
 *  - limit (int, default 20, max 100)
 *  - include = variants,categories,filters,media  (comma-separated, optional)
 *  - light=1 (or picker=1) — with q and no other filters, use fast minimal search for admin pickers only.
 *    Omit for full inventory-style payload (default).
 */
module.exports.getProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    // parse & sanitize query params
    const {
      q,
      category_id,
      category, // category name (string)
      category_path, // category path (string) e.g., "men/clothing/jacket"
      brand,
      vendor_id,
      min_price,
      max_price,
      color,
      size,
      gender,
      country,
      sku,
      sort,
      sort_by = "created_at",
      sort_order = "desc",
      page: pageQ,
      limit: limitQ,
      include = "variants,categories,filters,media",
      light,
      picker,
    } = req.query;

    // dynamic filters can be provided as repeated query param: dynamic_filter=type:name
    // If sent as comma-separated in a single param, split as well.
    let dynamic_filters = [];
    if (req.query.dynamic_filter) {
      if (Array.isArray(req.query.dynamic_filter)) {
        dynamic_filters = req.query.dynamic_filter;
      } else {
        dynamic_filters = String(req.query.dynamic_filter)
          .split(",")
          .map((s) => s.trim());
      }
      // expect each as "type:name"
      dynamic_filters = dynamic_filters
        .map((df) => {
          const [filter_type, ...rest] = df.split(":");
          const filter_name = rest.join(":");
          if (!filter_type || !filter_name) return null;
          return {
            filter_type: filter_type.trim(),
            filter_name: filter_name.trim(),
          };
        })
        .filter(Boolean);
    }

    // pagination
    const page = Math.max(1, parseInt(pageQ, 10) || 1);
    let limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
    const offset = (page - 1) * limit;

    // validate vendor/category UUIDs
    if (vendor_id && !isValidUUID(vendor_id))
      return next(new AppError("Invalid vendor_id", 400));
    if (category_id && !isValidUUID(category_id))
      return next(new AppError("Invalid category_id", 400));

    // If category path provided, look up category_id by exact path match
    let resolvedCategoryId = category_id;
    if (category_path && !category_id) {
      const categoryLookup = await client.query(
        `SELECT id FROM categories WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
        [category_path]
      );
      if (categoryLookup.rowCount > 0) {
        resolvedCategoryId = categoryLookup.rows[0].id;
      }
    } else if (category && !category_id && !category_path) {
      // Fallback: If category name provided, look up category_id
      const categoryLookup = await client.query(
        `SELECT id FROM categories WHERE name = $1 AND deleted_at IS NULL LIMIT 1`,
        [category]
      );
      if (categoryLookup.rowCount > 0) {
        resolvedCategoryId = categoryLookup.rows[0].id;
      }
    }

    // parse include flags
    const includeParts = new Set(
      include
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

    // Lightweight path: only when explicitly requested (hero / best-sellers / new-arrivals pickers).
    // Inventory search uses q without `light=1` and must receive the full getProducts payload.
    const lightFlag = light ?? picker;
    const wantLightPickerSearch =
      lightFlag === "1" ||
      String(lightFlag || "").toLowerCase() === "true";
    const hasFilters =
      resolvedCategoryId ||
      brand ||
      vendor_id ||
      !isNaN(Number(min_price)) ||
      !isNaN(Number(max_price)) ||
      color ||
      size ||
      gender ||
      country ||
      sku ||
      (Array.isArray(dynamic_filters) && dynamic_filters.length > 0);
    if (q && !hasFilters && wantLightPickerSearch) {
      const lightResult = await ProductService.getProductsSearchLight(
        { q, limit, offset },
        client
      );
      const totalPages = Math.max(1, Math.ceil(lightResult.total / limit));
      return sendResponse(res, 200, true, "Products fetched", {
        total: lightResult.total,
        mapped_total: 0,
        inactive_total: 0,
        page,
        limit,
        total_pages: totalPages,
        products: lightResult.products,
      });
    }

    // build options object to pass into service
    const options = {
      q,
      category_id: resolvedCategoryId || null,
      brand: brand || null,
      vendor_id: vendor_id || null,
      min_price: isNaN(Number(min_price)) ? null : Number(min_price),
      max_price: isNaN(Number(max_price)) ? null : Number(max_price),
      color: color || null,
      size: size || null,
      gender: gender || null,
      country: country || null,
      sku: sku || null,
      dynamic_filters,
      sort_by,
      sort_order: sort_order.toLowerCase() === "asc" ? "asc" : "desc",
      limit,
      offset,
      include: {
        variants: includeParts.has("variants"),
        categories: includeParts.has("categories"),
        filters: includeParts.has("filters"),
        media: includeParts.has("media"),
      },
    };

    const { total, mappedTotal, inactiveTotal, products } = await ProductService.getProducts(
      options,
      client
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return sendResponse(res, 200, true, "Products fetched", {
      total,
      mapped_total: mappedTotal,
      inactive_total: inactiveTotal,
      page,
      limit,
      total_pages: totalPages,
      products,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch products", 500));
  } finally {
    client.release();
  }
});
//before dynamic filteration
/* module.exports.getProductsFromOurCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const {
            q,
            category_id,
            brand,
            vendor_id,
            min_price,
            max_price,
            color,
            size,
            gender,
            country,
            sku,
            sort_by = "created_at",
            sort_order = "desc",
            page: pageQ,
            limit: limitQ,
            include = "variants,categories,filters,media"
        } = req.query;

        let dynamic_filters = [];
        if (req.query.dynamic_filter) {
            if (Array.isArray(req.query.dynamic_filter)) {
                dynamic_filters = req.query.dynamic_filter;
            } else {
                dynamic_filters = String(req.query.dynamic_filter).split(",").map(s => s.trim());
            }
            dynamic_filters = dynamic_filters
                .map(df => {
                    const [filter_type, ...rest] = df.split(":");
                    const filter_name = rest.join(":");
                    if (!filter_type || !filter_name) return null;
                    return { filter_type: filter_type.trim(), filter_name: filter_name.trim() };
                })
                .filter(Boolean);
        }

        const page = Math.max(1, parseInt(pageQ, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
        const offset = (page - 1) * limit;

        if (vendor_id && !isValidUUID(vendor_id)) return next(new AppError("Invalid vendor_id", 400));
        if (category_id && !isValidUUID(category_id)) return next(new AppError("Invalid category_id", 400));

        const includeParts = new Set(include.split(",").map(s => s.trim()).filter(Boolean));

        // ✅ Step 1: Find all vendor categories mapped to this "our category"
        //    PLUS all of their descendants (children, grandchildren, ...)
        // let vendorCategoryIds = null;

        // ✅ Step 1: Find vendor categories mapped to given our_category_id OR any of its child our-categories
        let vendorCategoryIds = [];

        if (category_id) {
            // 1️⃣ Find the given our-category and its entire child subtree (only our categories)
            const ourCatsRes = await client.query(
                `
    WITH RECURSIVE our_subtree AS (
      SELECT id
      FROM categories
      WHERE id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT c.id
      FROM categories c
      INNER JOIN our_subtree os ON c.parent_id = os.id
      WHERE c.deleted_at IS NULL
    )
    SELECT id FROM our_subtree;
    `,
                [category_id]
            );

            const ourCatIds = ourCatsRes.rows.map(r => r.id);
            if (ourCatIds.length === 0) {
                return sendResponse(res, 200, true, "Products fetched", {
                    total: 0,
                    page,
                    limit,
                    total_pages: 1,
                    products: []
                });
            }

            // 2️⃣ Find all vendor categories mapped to ANY of those our-categories
            const vendorMappedRes = await client.query(
                `
    SELECT id
    FROM categories
    WHERE deleted_at IS NULL
      AND is_our_category = FALSE
      AND our_category = ANY($1)
    `,
                [ourCatIds]
            );

            const mappedVendorIds = vendorMappedRes.rows.map(r => r.id);

            // 3️⃣ For each mapped vendor category, include its descendants also
            if (mappedVendorIds.length > 0) {
                const vendorDescRes = await client.query(
                    `
      WITH RECURSIVE vendor_descendants AS (
        SELECT id FROM categories WHERE id = ANY($1)
        UNION ALL
        SELECT c.id
        FROM categories c
        JOIN vendor_descendants vd ON c.parent_id = vd.id
        WHERE c.deleted_at IS NULL
      )
      SELECT DISTINCT id FROM vendor_descendants;
      `,
                    [mappedVendorIds]
                );

                vendorCategoryIds = vendorDescRes.rows.map(r => r.id);
            }

            // ⚠️ Safety: ensure unique IDs
            vendorCategoryIds = Array.from(new Set(vendorCategoryIds));
        }


        // ✅ Step 2: Prepare options for ProductService
        const options = {
            q,
            category_id: category_id || null,           // our_category is handled via mapping above
            vendor_category_ids: vendorCategoryIds,      // mapped vendor category IDs incl. descendants
            brand: brand || null,
            vendor_id: vendor_id || null,
            min_price: isNaN(Number(min_price)) ? null : Number(min_price),
            max_price: isNaN(Number(max_price)) ? null : Number(max_price),
            color: color || null,
            size: size || null,
            gender: gender || null,
            country: country || null,
            sku: sku || null,
            dynamic_filters,
            sort_by,
            sort_order: String(sort_order).toLowerCase() === "asc" ? "asc" : "desc",
            limit,
            offset,
            include: {
                variants: includeParts.has("variants"),
                categories: includeParts.has("categories"),
                filters: includeParts.has("filters"),
                media: includeParts.has("media")
            }
        };

        // ✅ Step 3: Fetch products using ProductService
        const { total, products } = await ProductService.getProductsFromOurCategory(options, client);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        return sendResponse(res, 200, true, "Products fetched", {
            total,
            page,
            limit,
            total_pages: totalPages,
            products
        });
    } catch (err) {
        console.error("Error in getProductsFromOurCategories:", err);
        return next(new AppError(err.message || "Failed to fetch products", 500));
    } finally {
        client.release();
    }
}); */

//before adding wishlist and token
/* module.exports.getProductsFromOurCategories = catchAsync(
  async (req, res, next) => {
    const client = await dbPool.connect();
    try {
      const {
        q,
        category_id,
        vendor_id,
        min_price,
        max_price,
        gender,
        country,
        sku,
        sort_by = "created_at",
        sort_order = "desc",
        page: pageQ,
        limit: limitQ,
        include = "variants,categories,filters,media",
      } = req.query;

      // ✅ Multi-select handling
      const parseMulti = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map((x) => x.trim());
        return String(v)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      };

      const brands = parseMulti(req.query.brand);
      const colors = parseMulti(req.query.color);
      const sizes = parseMulti(req.query.size);

      const page = Math.max(1, parseInt(pageQ, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
      const offset = (page - 1) * limit;

      const includeParts = new Set(
        include
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );

      const options = {
        q,
        category_id,
        vendor_id,
        brands,
        colors,
        sizes,
        min_price: isNaN(Number(min_price)) ? null : Number(min_price),
        max_price: isNaN(Number(max_price)) ? null : Number(max_price),
        gender,
        country,
        sku,
        sort_by,
        sort_order,
        limit,
        offset,
        include: {
          variants: includeParts.has("variants"),
          categories: includeParts.has("categories"),
          filters: includeParts.has("filters"),
          media: includeParts.has("media"),
        },
      };

      const { total, products } =
        await ProductService.getProductsFromOurCategory(options, client);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return sendResponse(res, 200, true, "Products fetched", {
        total,
        page,
        limit,
        total_pages: totalPages,
        products,
      });
    } catch (err) {
      console.error("Error in getProductsFromOurCategories:", err);
      return next(new AppError(err.message || "Failed to fetch products", 500));
    } finally {
      client.release();
    }
  }
); */

const jwt = require("jsonwebtoken");

module.exports.getProductsFromOurCategories = catchAsync(
  async (req, res, next) => {
    const client = await dbPool.connect();
    try {
      const {
        q,
        category_id,
        category_slug,
        curated_slug,
        vendor_id,
        min_price,
        max_price,
        country,
        sku,
        sort_by = "created_at",
        sort_order = "desc",
        page: pageQ,
        limit: limitQ,
        include = "variants,categories,filters,media",
      } = req.query;

      let resolvedCategoryId = category_id;
      if (!resolvedCategoryId && category_slug) {
        const slugLookup = await client.query(
          `SELECT id FROM categories WHERE slug = $1 AND is_our_category = true AND deleted_at IS NULL LIMIT 1`,
          [category_slug]
        );
        if (slugLookup.rows.length > 0) {
          resolvedCategoryId = slugLookup.rows[0].id;
        }
      }

      const parseMulti = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map((x) => x.trim());
        return String(v)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      };

      const brands = parseMulti(req.query.brand);
      const colors = parseMulti(req.query.color);
      const sizes = parseMulti(req.query.size);
      const genders = parseMulti(req.query.gender);

      const page = Math.max(1, parseInt(pageQ, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
      const offset = (page - 1) * limit;

      const includeParts = new Set(
        include
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );

      let user_id = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        let token = authHeader.split(" ")[1];
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          user_id = decoded.id || decoded.user_id || decoded.userId;
        } catch (err) {
          user_id = null;
        }
      }

      const options = {
        q,
        category_id: resolvedCategoryId,
        curated_slug: curated_slug && String(curated_slug).trim() ? String(curated_slug).trim().toLowerCase() : null,
        vendor_id,
        brands,
        colors,
        sizes,
        min_price: isNaN(Number(min_price)) ? null : Number(min_price),
        max_price: isNaN(Number(max_price)) ? null : Number(max_price),
        genders,
        country,
        sku,
        sort_by,
        sort_order,
        limit,
        offset,
        user_id,
        include: {
          variants: includeParts.has("variants"),
          categories: includeParts.has("categories"),
          filters: includeParts.has("filters"),
          media: includeParts.has("media"),
        },
      };

      const { total, products } =
        await ProductService.getProductsFromOurCategory(options, client);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return sendResponse(res, 200, true, "Products fetched", {
        total,
        page,
        limit,
        total_pages: totalPages,
        products,
      });
    } catch (err) {
      console.error("Error in getProductsFromOurCategories:", err);
      return next(new AppError(err.message || "Failed to fetch products", 500));
    } finally {
      client.release();
    }
  }
);

/**
 * 🔍 NEW: Autocomplete API for search bar
 * GET /api/v1/products/autocomplete?q=shoe&limit=10
 */
module.exports.getSearchAutocomplete = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    let q = (req.query.q || "").trim();
    let limitQ = req.query.limit;

    // normalize limit
    const limit = Math.min(20, Math.max(1, parseInt(limitQ, 10) || 10));

    // too small query? return empty suggestions
    if (!q || q.length < 2) {
      return sendResponse(res, 200, true, "Suggestions fetched", {
        query: q,
        suggestions: [],
      });
    }

    const suggestions = await ProductService.getSearchAutocomplete(
      { q, limit },
      client
    );

    return sendResponse(res, 200, true, "Suggestions fetched", {
      query: q,
      suggestions,
    });
  } catch (err) {
    console.error("Error in getSearchAutocomplete:", err);
    return next(
      new AppError(err.message || "Failed to fetch suggestions", 500)
    );
  } finally {
    client.release();
  }
});

// module.exports.getDynamicFilters = catchAsync(async (req, res, next) => {
//     const client = await dbPool.connect();

//     try {
//         const { category_id, vendor_id, min_price, max_price } = req.query;

//         /** ✅ Helper to parse both `brand=Gucci&brand=LV` and `brand=Gucci,LV` */
//         const parseMulti = (value) => {
//             if (!value) return [];
//             if (Array.isArray(value)) return value.map(v => v.trim());
//             return String(value).split(",").map(v => v.trim()).filter(Boolean);
//         };

//         const brands = parseMulti(req.query.brand);
//         const colors = parseMulti(req.query.color);
//         const sizes = parseMulti(req.query.size);

//         if (category_id && !isValidUUID(category_id)) {
//             return next(new AppError("Invalid category_id", 400));
//         }
//         if (vendor_id && !isValidUUID(vendor_id)) {
//             return next(new AppError("Invalid vendor_id", 400));
//         }

//         /**
//          * ✅ STEP 1: Resolve category tree (our category → vendor categories & descendants)
//          */
//         let vendorCategoryIds = [];

//         if (category_id) {
//             const ourCatsRes = await client.query(`
//                 WITH RECURSIVE our_subtree AS (
//                     SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL
//                     UNION ALL
//                     SELECT c.id FROM categories c
//                     INNER JOIN our_subtree os ON c.parent_id = os.id
//                     WHERE c.deleted_at IS NULL
//                 )
//                 SELECT id FROM our_subtree;
//             `, [category_id]);

//             const ourCatIds = ourCatsRes.rows.map(r => r.id);

//             const vendorMappedRes = await client.query(`
//                 SELECT id FROM categories
//                 WHERE deleted_at IS NULL
//                   AND is_our_category = FALSE
//                   AND our_category = ANY ($1)
//             `, [ourCatIds]);

//             const mappedIds = vendorMappedRes.rows.map(r => r.id);

//             if (mappedIds.length > 0) {
//                 const vendorDescRes = await client.query(`
//                     WITH RECURSIVE vendor_desc AS (
//                         SELECT id FROM categories WHERE id = ANY($1)
//                         UNION ALL
//                         SELECT c.id FROM categories c
//                         INNER JOIN vendor_desc vd ON c.parent_id = vd.id
//                         WHERE c.deleted_at IS NULL
//                     )
//                     SELECT DISTINCT id FROM vendor_desc;
//                 `, [mappedIds]);

//                 vendorCategoryIds = vendorDescRes.rows.map(r => r.id);
//             }
//         }

//         /**
//          * ✅ STEP 2: Build where clause based on selected filters
//          */
//         let params = [];
//         let where = "p.deleted_at IS NULL";

//         if (vendorCategoryIds.length > 0) {
//             params.push(vendorCategoryIds);
//             where += ` AND EXISTS (
//                 SELECT 1 FROM product_categories pc
//                 WHERE pc.product_id = p.id
//                 AND pc.category_id = ANY($${params.length})
//                 AND pc.deleted_at IS NULL
//             )`;
//         }

//         if (vendor_id) {
//             params.push(vendor_id);
//             where += ` AND p.vendor_id = $${params.length}`;
//         }

//         /** ✅ MULTI BRAND FILTER */
//         /** ✅ MULTI BRAND FILTER (Corrected param binding) */
//         if (brands.length > 0) {
//             const startIndex = params.length + 1; // starting index of placeholders
//             brands.forEach(b => params.push(`%${b}%`)); // push first

//             const placeholders = brands.map((_, idx) => `$${startIndex + idx}`).join(",");

//             where += ` AND p.brand_name ILIKE ANY(ARRAY[${placeholders}])`;
//         }

//         /** ✅ MULTI COLOR FILTER */
//         /** ✅ MULTI COLOR FILTER */
//         if (colors.length > 0) {
//             const startIndex = params.length + 1;
//             colors.forEach(c => params.push(c));

//             const placeholders = colors.map((_, idx) => `$${startIndex + idx}`).join(",");

//             where += ` AND EXISTS (
//         SELECT 1 FROM product_variants pv
//         WHERE pv.product_id = p.id
//         AND pv.deleted_at IS NULL
//         AND (
//              pv.variant_color = ANY(ARRAY[${placeholders}])
//              OR pv.attributes->>'color' = ANY(ARRAY[${placeholders}])
//         )
//     )`;
//         }

//         /** ✅ MULTI SIZE FILTER */
//         /** ✅ MULTI SIZE FILTER */
// if (sizes.length > 0) {
//     const startIndex = params.length + 1;
//     sizes.forEach(s => params.push(s));

//     const placeholders = sizes.map((_, idx) => `$${startIndex + idx}`).join(",");

//     where += ` AND EXISTS (
//         SELECT 1 FROM product_variants pv
//         WHERE pv.product_id = p.id
//         AND pv.deleted_at IS NULL
//         AND (
//              pv.variant_size = ANY(ARRAY[${placeholders}])
//              OR pv.attributes->>'size' = ANY(ARRAY[${placeholders}])
//         )
//     )`;
// }

//         /** ✅ PRICE FILTER */
//         if (min_price != null) {
//             params.push(Number(min_price));
//             where += ` AND EXISTS (
//                 SELECT 1 FROM product_variants pv
//                 WHERE pv.product_id = p.id
//                 AND COALESCE(pv.sale_price, pv.price) >= $${params.length}
//             )`;
//         }

//         if (max_price != null) {
//             params.push(Number(max_price));
//             where += ` AND EXISTS (
//                 SELECT 1 FROM product_variants pv
//                 WHERE pv.product_id = p.id
//                 AND COALESCE(pv.sale_price, pv.price) <= $${params.length}
//             )`;
//         }

//         /**
//          * ✅ STEP 3: Calculate filters from filtered product result
//          */
//         const filterQuery = `
//             SELECT
//                 ARRAY_AGG(DISTINCT p.brand_name) FILTER (WHERE p.brand_name IS NOT NULL) AS brands,
//                 ARRAY_AGG(DISTINCT pv.variant_color) FILTER (WHERE pv.variant_color IS NOT NULL) AS colors,
//                 ARRAY_AGG(DISTINCT pv.variant_size) FILTER (WHERE pv.variant_size IS NOT NULL) AS sizes,
//                 MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
//                 MAX(COALESCE(pv.sale_price, pv.price)) AS max_price
//             FROM products p
//             LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
//             WHERE ${where};
//         `;

//         const result = await client.query(filterQuery, params);
//         const filters = result.rows[0];

//         return sendResponse(res, 200, true, "Filters updated", {
//             brands: filters.brands || [],
//             colors: filters.colors || [],
//             sizes: filters.sizes || [],
//             price: {
//                 min: Number(filters.min_price || 0),
//                 max: Number(filters.max_price || 0),
//             }
//         });

//     } catch (err) {
//         console.error("Dynamic filter error:", err);
//         return next(new AppError(err.message || "Failed to fetch filters", 500));
//     } finally {
//         client.release();
//     }
// });

// function breafing

// module.exports.getDynamicFilters = catchAsync(async (req, res, next) => {
//     const client = await dbPool.connect();
//     try {
//         const { category_id, vendor_id } = req.query;

//         if (category_id && !isValidUUID(category_id)) {
//             return next(new AppError("Invalid category_id", 400));
//         }

//         /** ✅ STEP 1: Resolve all mapped vendor category_ids (same logic as your main products API) */
//         let vendorCategoryIds = [];

//         if (category_id) {
//             const ourCatsRes = await client.query(
//                 `
//                 WITH RECURSIVE our_subtree AS (
//                     SELECT id
//                     FROM categories
//                     WHERE id = $1 AND deleted_at IS NULL
//                     UNION ALL
//                     SELECT c.id
//                     FROM categories c
//                     INNER JOIN our_subtree os ON c.parent_id = os.id
//                     WHERE c.deleted_at IS NULL
//                 )
//                 SELECT id FROM our_subtree;
//             `,
//                 [category_id]
//             );

//             const ourCatIds = ourCatsRes.rows.map(r => r.id);

//             const vendorMappedRes = await client.query(
//                 `SELECT id FROM categories WHERE is_our_category = false AND our_category = ANY($1) AND deleted_at IS NULL`,
//                 [ourCatIds]
//             );

//             const mappedVendorIds = vendorMappedRes.rows.map(r => r.id);

//             if (mappedVendorIds.length > 0) {
//                 const vendorDescRes = await client.query(
//                     `
//                     WITH RECURSIVE vendor_descendants AS (
//                       SELECT id FROM categories WHERE id = ANY($1)
//                       UNION ALL
//                       SELECT c.id FROM categories c
//                       JOIN vendor_descendants vd ON c.parent_id = vd.id
//                       WHERE c.deleted_at IS NULL
//                     )
//                     SELECT DISTINCT id FROM vendor_descendants;
//                 `,
//                     [mappedVendorIds]
//                 );

//                 vendorCategoryIds = vendorDescRes.rows.map(r => r.id);
//             }

//             vendorCategoryIds = Array.from(new Set(vendorCategoryIds));
//         }

//         if (vendor_id && !isValidUUID(vendor_id)) {
//             return next(new AppError("Invalid vendor_id", 400));
//         }

//         /** ✅ STEP 2: Fetch ALL dynamic filters based on vendor categories */
//         let params = [];
//         let filterWhere = "p.deleted_at IS NULL";

//         if (vendorCategoryIds.length > 0) {
//             params.push(vendorCategoryIds);
//             filterWhere += ` AND EXISTS (
//                 SELECT 1 FROM product_categories pc
//                 WHERE pc.product_id = p.id AND pc.category_id = ANY($${params.length})
//             )`;
//         }

//         if (vendor_id) {
//             params.push(vendor_id);
//             filterWhere += ` AND p.vendor_id = $${params.length}`;
//         }

//         /** ✅ Fetch brands, colors, sizes, min/max price */
//         const filtersSQL = `
//             SELECT
//                 ARRAY_AGG(DISTINCT p.brand_name) FILTER (WHERE p.brand_name IS NOT NULL) AS brands,
//                 ARRAY_AGG(DISTINCT pv.variant_color) FILTER (WHERE pv.variant_color IS NOT NULL) AS colors,
//                 ARRAY_AGG(DISTINCT pv.variant_size) FILTER (WHERE pv.variant_size IS NOT NULL) AS sizes,
//                 ARRAY_AGG(DISTINCT pv.normalized_size) FILTER (WHERE pv.normalized_size IS NOT NULL) AS normalized_sizes,
//                 ARRAY_AGG(DISTINCT pv.normalized_color) FILTER (WHERE pv.normalized_color IS NOT NULL) AS normalized_colors,
//                 MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
//                 MAX(COALESCE(pv.sale_price, pv.price)) AS max_price
//             FROM products p
//             LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
//             WHERE ${filterWhere};
//         `;

//         const filtersRes = await client.query(filtersSQL, params);
//         const filters = filtersRes.rows[0];

//         /** ✅ Get child our-categories (for showing left filter list) */
//         let childCats = [];
//         if (category_id) {
//             const childRes = await client.query(
//                 `SELECT id, name, slug FROM categories WHERE parent_id = $1 AND is_our_category = true AND deleted_at IS NULL`,
//                 [category_id]
//             );
//             childCats = childRes.rows;
//         }

//         return sendResponse(res, 200, true, "Filters fetched", {
//             brands: filters.brands || [],
//             // colors: filters.colors || [],
//             // sizes: filters.sizes || [],
//             sizes: filters.normalized_sizes || [],
//             colors: filters.normalized_colors || [],
//             price: {
//                 min: Number(filters.min_price || 0),
//                 max: Number(filters.max_price || 0)
//             },
//             child_categories: childCats
//         });

//     } catch (err) {
//         console.error("Error in getDynamicFilters:", err);
//         return next(new AppError(err.message || "Failed to load filters", 500));
//     } finally {
//         client.release();
//     }
// });

// module.exports.getDynamicFilters = catchAsync(async (req, res, next) => {
//   const client = await dbPool.connect();
//   try {
//     const { category_id, vendor_id, brand, size, color, min_price, max_price , q} =
//       req.query;

//     if (category_id && !isValidUUID(category_id)) {
//       return next(new AppError("Invalid category_id", 400));
//     }
//     if (vendor_id && !isValidUUID(vendor_id)) {
//       return next(new AppError("Invalid vendor_id", 400));
//     }

//     const brands = Array.isArray(brand) ? brand : brand ? [brand] : [];
//     const sizes = Array.isArray(size) ? size : size ? [size] : [];
//     const colors = Array.isArray(color) ? color : color ? [color] : [];

//     /** ✅ STEP-1: Resolve mapped vendor category IDs */
//     let vendorCategoryIds = [];

//     if (category_id) {
//       const ourCats = await client.query(
//         `
//             WITH RECURSIVE our_subtree AS (
//                 SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL
//                 UNION ALL
//                 SELECT c.id FROM categories c
//                 JOIN our_subtree os ON c.parent_id = os.id
//                 WHERE c.deleted_at IS NULL
//             )
//             SELECT id FROM our_subtree;
//             `,
//         [category_id]
//       );

//       const ourCatIds = ourCats.rows.map((r) => r.id);

//       const vendorMapped = await client.query(
//         `SELECT id FROM categories WHERE is_our_category = false AND deleted_at IS NULL AND our_category = ANY($1)`,
//         [ourCatIds]
//       );

//       const mappedVendorIds = vendorMapped.rows.map((r) => r.id);

//       if (mappedVendorIds.length > 0) {
//         const vendorDesc = await client.query(
//           `
//                 WITH RECURSIVE vendor_descendants AS (
//                     SELECT id FROM categories WHERE id = ANY($1)
//                     UNION ALL
//                     SELECT c.id FROM categories c
//                     JOIN vendor_descendants vd ON c.parent_id = vd.id
//                     WHERE c.deleted_at IS NULL
//                 )
//                 SELECT DISTINCT id FROM vendor_descendants;
//                 `,
//           [mappedVendorIds]
//         );

//         vendorCategoryIds = vendorDesc.rows.map((r) => r.id);
//       }
//     }

//     /** ✅ STEP-2: Build WHERE for base filters */
//     let baseParams = [];
//     let baseWhere = "p.deleted_at IS NULL";

//     if (vendorCategoryIds.length > 0) {
//       baseParams.push(vendorCategoryIds);
//       baseWhere += ` AND EXISTS (
//                 SELECT 1 FROM product_categories pc
//                 WHERE pc.product_id = p.id AND pc.category_id = ANY($${baseParams.length})
//             )`;
//     }

//     if (vendor_id) {
//       baseParams.push(vendor_id);
//       baseWhere += ` AND p.vendor_id = $${baseParams.length}`;
//     }

//     /** ✅ STEP-3: Active filters (user applied side filters) */
//     let params = [...baseParams];
//     let filterWhere = baseWhere;

//     if (brands.length > 0) {
//       params.push(brands);
//       filterWhere += ` AND p.brand_name = ANY($${params.length})`;
//     }

//     if (sizes.length > 0) {
//       params.push(sizes);
//       filterWhere += ` AND pv.normalized_size_final = ANY($${params.length})`;
//     }

//     if (colors.length > 0) {
//       params.push(colors);
//       filterWhere += ` AND pv.normalized_color = ANY($${params.length})`;
//     }

//     if (min_price) {
//       params.push(Number(min_price));
//       filterWhere += ` AND COALESCE(pv.sale_price, pv.price) >= $${params.length}`;
//     }

//     if (max_price) {
//       params.push(Number(max_price));
//       filterWhere += ` AND COALESCE(pv.sale_price, pv.price) <= $${params.length}`;
//     }

//     /** ✅ STEP-4: Get all filters ONLY from products inside category */
//     const allFiltersSQL = `
//             SELECT
//                 ARRAY_AGG(DISTINCT p.brand_name) FILTER (WHERE p.brand_name IS NOT NULL) AS brands,
//                 ARRAY_AGG(DISTINCT pv.normalized_color) FILTER (WHERE pv.normalized_color IS NOT NULL) AS colors,
//                -- ARRAY_AGG(DISTINCT pv.normalized_size_final) FILTER (WHERE pv.normalized_size_final IS NOT NULL) AS sizes
//                ARRAY_AGG(DISTINCT pv.variant_size) FILTER (WHERE pv.variant_size IS NOT NULL) AS sizes
//             FROM products p
//             INNER JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
//             LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
//             WHERE ${baseWhere};
//         `;

//     /** ✅ STEP-5: Active filters should affect price range */
//     const activeFiltersSQL = `
//             SELECT
//                 MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
//                 MAX(COALESCE(pv.sale_price, pv.price)) AS max_price
//             FROM products p
//             INNER JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
//             LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
//             WHERE ${filterWhere};
//         `;

//     const [allFiltersRes, activeFiltersRes] = await Promise.all([
//       client.query(allFiltersSQL, baseParams),
//       client.query(activeFiltersSQL, params),
//     ]);

//     let childCats = [];
//     if (category_id) {
//       const subRes = await client.query(
//         `SELECT id, name, slug FROM categories WHERE parent_id = $1 AND is_our_category = true AND deleted_at IS NULL`,
//         [category_id]
//       );
//       childCats = subRes.rows;
//     }

//     return sendResponse(res, 200, true, "Filters fetched", {
//       brands: allFiltersRes.rows[0].brands || [],
//       colors: allFiltersRes.rows[0].colors || [],
//       sizes: allFiltersRes.rows[0].sizes || [],
//       price: {
//         min: Number(activeFiltersRes.rows[0].min_price || 0),
//         max: Number(activeFiltersRes.rows[0].max_price || 0),
//       },
//       child_categories: childCats,
//     });
//   } catch (err) {
//     console.error("getDynamicFilters Error:", err);
//     return next(new AppError(err.message || "Failed to load filters", 500));
//   } finally {
//     client.release();
//   }
// });

module.exports.getDynamicFilters = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      category_id,
      category_slug,
      vendor_id,
      brand,
      size,
      color,
      gender,
      min_price,
      max_price,
      q,
    } = req.query;

    // ── Cache: return cached facets if available (60 s TTL) ──
    const cacheKey = filterCache.buildKey({
      cat: category_id, cs: category_slug, q, vid: vendor_id,
      b: brand, c: color, s: size, g: gender,
      mn: min_price, mx: max_price,
    });
    const cached = filterCache.get(cacheKey);
    if (cached) {
      return sendResponse(res, 200, true, "Filters fetched", cached);
    }

    if (category_id && !isValidUUID(category_id)) {
      return next(new AppError("Invalid category_id", 400));
    }
    if (vendor_id && !isValidUUID(vendor_id)) {
      return next(new AppError("Invalid vendor_id", 400));
    }

    let resolvedCategoryId = category_id;
    if (!resolvedCategoryId && category_slug) {
      const slugLookup = await client.query(
        `SELECT id FROM categories WHERE slug = $1 AND is_our_category = true AND deleted_at IS NULL LIMIT 1`,
        [category_slug]
      );
      if (slugLookup.rows.length > 0) {
        resolvedCategoryId = slugLookup.rows[0].id;
      }
    }

    const brands = Array.isArray(brand) ? brand : brand ? [brand] : [];
    const sizes = Array.isArray(size) ? size : size ? [size] : [];
    const colors = Array.isArray(color) ? color : color ? [color] : [];
    const genders = Array.isArray(gender) ? gender : gender ? [gender] : [];

    let ourCatIds = [];
    let ourCategoryProductsExist = false;

    if (resolvedCategoryId) {
      ourCatIds = await client
        .query(
          `
          WITH RECURSIVE our_subtree AS (
              SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL
              UNION ALL
              SELECT c.id FROM categories c
              JOIN our_subtree os ON c.parent_id = os.id
              WHERE c.deleted_at IS NULL
          )
          SELECT id FROM our_subtree;
        `,
          [resolvedCategoryId]
        )
        .then((res) => res.rows.map((r) => r.id));

      if (ourCatIds.length > 0) {
        const directMapCheck = await client.query(
          `SELECT COUNT(*)::int AS count FROM product_our_category_map WHERE our_category_id = ANY($1)`,
          [ourCatIds]
        );
        ourCategoryProductsExist = directMapCheck.rows[0].count > 0;
      }
    }

    /** STEP-2: Base WHERE */
    let baseParams = [];
    let baseWhere = `p.deleted_at IS NULL
      AND p.is_active = TRUE
      AND (p.vendor_id IS NULL OR EXISTS (
        SELECT 1 FROM vendors v WHERE v.id = p.vendor_id AND v.status = 'active'
      ))`;

    if (ourCategoryProductsExist) {
      baseParams.push(ourCatIds);
      baseWhere += `
        AND EXISTS (
          SELECT 1 FROM product_our_category_map pom
          WHERE pom.product_id = p.id
            AND pom.our_category_id = ANY($${baseParams.length}::uuid[])
        )
      `;
    } else if (resolvedCategoryId) {
      return sendResponse(res, 200, true, "Filters fetched", {
        brands: [],
        colors: [],
        sizes: [],
        genders: [],
        price: { min: 0, max: 0 },
        child_categories: [],
      });
    }

    if (vendor_id) {
      baseParams.push(vendor_id);
      baseWhere += ` AND p.vendor_id = $${baseParams.length}`;
    }

    // Match DB brand_name_normalized: replace non-alphanumeric with space, collapse spaces, trim, lower (e.g. "Dolce & Gabbana" -> "dolce gabbana")
    const normalizeBrands = (items = []) =>
      items
        .map((b) =>
          String(b)
            .trim()
            .replace(/[^a-zA-Z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean);

    const buildWhere = ({
      includeBrand = true,
      includeColor = true,
      includeSize = true,
      includeGender = true,
      includePrice = true,
      includeSearch = true,
    } = {}) => {
      let params = [...baseParams];
      let where = baseWhere;

      if (includeBrand && brands.length > 0) {
        params.push(normalizeBrands(brands));
        // Compare with collapsed spaces so "dolce  gabbana" (DB) matches "dolce gabbana" (param)
        where += ` AND TRIM(REGEXP_REPLACE(COALESCE(p.brand_name_normalized, ''), '\\s+', ' ', 'g')) = ANY($${params.length})`;
      }

      if (includeSize && sizes.length > 0) {
        params.push(sizes);
        where += ` AND pv.normalized_size_final = ANY($${params.length}) AND pv.stock > 0`;
      }

      if (includeColor && colors.length > 0) {
        const colorParams = normalizeColorFilterParams(colors);
        if (colorParams.length > 0) {
          params.push(colorParams);
          where += ` AND ${sqlVariantMatchesColorParams("pv", params.length)}`;
        }
      }

      if (includeGender && genders.length > 0) {
        const normalizedGenders = genders
          .map((g) => String(g).trim().toLowerCase())
          .filter(Boolean);
        if (normalizedGenders.length > 0) {
          params.push(normalizedGenders);
          where += ` AND LOWER(p.gender) = ANY($${params.length})`;
        }
      }

      if (includePrice && min_price) {
        params.push(Number(min_price));
        where += ` AND pv.price >= $${params.length}`;
      }

      if (includePrice && max_price) {
        params.push(Number(max_price));
        where += ` AND pv.price <= $${params.length}`;
      }

      if (includeSearch && q) {
        const tokens = String(q)
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 5);
        if (tokens.length > 0) {
          const tokenClauses = [];
          tokens.forEach((token) => {
            params.push(`%${token}%`);
            const key = params.length;
            tokenClauses.push(`
              (
                LOWER(p.name) LIKE $${key} OR
                p.brand_name_normalized LIKE $${key} OR
                LOWER(p.short_description) LIKE $${key} OR
                LOWER(pv.variant_size) LIKE $${key} OR
                LOWER(pv.normalized_color) LIKE $${key}
              )
            `);
          });
          where += ` AND ${tokenClauses.join(" AND ")}`;
        }
      }

      return { where, params };
    };

    /** STEP-4+5: Facets — one MATERIALIZED scan per filter context (list + counts merged; was 8 queries, now 4) */
    const mergedBrandFacetsSQL = `
      WITH brand_facets AS MATERIALIZED (
        SELECT DISTINCT p.id AS product_id,
          p.brand_name_normalized,
          p.brand_name
        FROM products p
        INNER JOIN product_our_category_map pom ON pom.product_id = p.id
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
        WHERE __WHERE__ AND p.brand_name_normalized IS NOT NULL
      )
      SELECT
        COALESCE((
          SELECT array_agg(display_name ORDER BY display_name)
          FROM (
            SELECT MIN(brand_name) AS display_name
            FROM brand_facets
            GROUP BY brand_name_normalized
          ) x
        ), ARRAY[]::text[]) AS brands,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'value', brand_name_normalized,
              'label', min_brand,
              'count', cnt
            ) ORDER BY min_brand
          )
          FROM (
            SELECT brand_name_normalized,
                   MIN(brand_name) AS min_brand,
                   COUNT(DISTINCT product_id)::int AS cnt
            FROM brand_facets
            GROUP BY brand_name_normalized
          ) y
        ), '[]'::json) AS brand_counts_json;
    `;

    const mergedColorFacetsSQL = `
      WITH color_tokens AS MATERIALIZED (
        SELECT p.id AS product_id,
               lower(trim(t)) AS token_lc
        FROM products p
        INNER JOIN product_our_category_map pom ON pom.product_id = p.id
        INNER JOIN product_variants pv ON pv.product_id = p.id
          AND pv.deleted_at IS NULL
          AND NULLIF(TRIM(COALESCE(pv.normalized_color, pv.attributes->>'color', '')), '') IS NOT NULL
        CROSS JOIN LATERAL unnest(
          regexp_split_to_array(
            TRIM(COALESCE(pv.normalized_color, pv.attributes->>'color')),
            E'${PG_COMPOSITE_COLOR_SPLIT_REGEX_E}'
          )
        ) AS u(t)
        WHERE __WHERE__
          AND NULLIF(TRIM(t), '') IS NOT NULL
          AND ${SQL_EXCLUDE_JUNK_COLOR_TOKEN_T}
          AND ${SQL_EXCLUDE_JUNK_VARIANT_COLOR_ONLY_PV}
      )
      SELECT
        COALESCE((
          SELECT array_agg(display_color ORDER BY display_color)
          FROM (
            SELECT DISTINCT initcap(token_lc) AS display_color
            FROM color_tokens
            WHERE token_lc IS NOT NULL AND token_lc <> ''
          ) cn
        ), ARRAY[]::text[]) AS colors,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'value', disp,
              'count', cnt
            ) ORDER BY disp
          )
          FROM (
            SELECT initcap(token_lc) AS disp,
                   COUNT(DISTINCT product_id)::int AS cnt
            FROM color_tokens
            WHERE token_lc IS NOT NULL AND token_lc <> ''
            GROUP BY token_lc
          ) cc
        ), '[]'::json) AS color_counts_json;
    `;

    const mergedSizeFacetsSQL = `
      WITH size_facets AS MATERIALIZED (
        SELECT DISTINCT p.id AS product_id,
          pv.normalized_size_final AS size_val,
          COALESCE(pv.size_type, 'Clothing') AS size_type
        FROM products p
        INNER JOIN product_our_category_map pom ON pom.product_id = p.id
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
        WHERE __WHERE__
          AND pv.normalized_size_final IS NOT NULL
          AND pv.stock > 0
      )
      SELECT
        COALESCE((
          SELECT array_agg(size_val ORDER BY size_val)
          FROM (SELECT DISTINCT size_val FROM size_facets) s
        ), ARRAY[]::text[]) AS sizes,
        COALESCE((
          SELECT json_agg(
            json_build_object('value', size_val, 'count', cnt, 'sizeType', size_type) ORDER BY size_type, size_val
          )
          FROM (
            SELECT size_val, size_type, COUNT(DISTINCT product_id)::int AS cnt
            FROM size_facets
            GROUP BY size_val, size_type
          ) sc
        ), '[]'::json) AS size_counts_json;
    `;

    const mergedGenderFacetsSQL = `
      WITH gender_facets AS MATERIALIZED (
        SELECT DISTINCT p.id AS product_id,
          LOWER(TRIM(p.gender)) AS gender_lc
        FROM products p
        INNER JOIN product_our_category_map pom ON pom.product_id = p.id
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
        WHERE __WHERE__
          AND p.gender IS NOT NULL AND TRIM(p.gender) <> ''
      )
      SELECT
        COALESCE((
          SELECT array_agg(gender_lc ORDER BY gender_lc)
          FROM (SELECT DISTINCT gender_lc FROM gender_facets) g
        ), ARRAY[]::text[]) AS genders,
        COALESCE((
          SELECT json_agg(
            json_build_object('value', gender_lc, 'count', cnt) ORDER BY gender_lc
          )
          FROM (
            SELECT gender_lc, COUNT(DISTINCT product_id)::int AS cnt
            FROM gender_facets
            GROUP BY gender_lc
          ) gc
        ), '[]'::json) AS gender_counts_json;
    `;

    /** STEP-5: Price range affected by q + filters */
    const activeFiltersSQL = `
      SELECT
          MIN(pv.price) AS min_price,
          MAX(pv.price) AS max_price,
          COUNT(DISTINCT p.id)::int AS total
      FROM products p
      INNER JOIN product_our_category_map pom ON pom.product_id = p.id
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      WHERE __WHERE__;
    `;

    const brandWhere = buildWhere({ includeBrand: false, includeColor: true, includeSize: true, includeGender: true });
    const colorWhere = buildWhere({ includeBrand: true, includeColor: false, includeSize: true, includeGender: true });
    const sizeWhere = buildWhere({ includeBrand: true, includeColor: true, includeSize: false, includeGender: true });
    const genderWhere = buildWhere({ includeBrand: true, includeColor: true, includeSize: true, includeGender: false });
    const priceWhere = buildWhere({ includeBrand: true, includeColor: true, includeSize: true, includeGender: true });

    const childCatsSql = `SELECT id, name, slug FROM categories WHERE parent_id = $1 AND is_our_category = true AND deleted_at IS NULL`;

    const jsonAggRows = (v) => {
      if (v == null) return [];
      if (Array.isArray(v)) return v;
      if (typeof v === "string") {
        try {
          const p = JSON.parse(v);
          return Array.isArray(p) ? p : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    const [brandMerged, colorMerged, sizeMerged, genderMerged, activeFiltersRes, childCatsRes] =
      await Promise.all([
        client.query(mergedBrandFacetsSQL.replace("__WHERE__", brandWhere.where), brandWhere.params),
        client.query(mergedColorFacetsSQL.replace("__WHERE__", colorWhere.where), colorWhere.params),
        client.query(mergedSizeFacetsSQL.replace("__WHERE__", sizeWhere.where), sizeWhere.params),
        client.query(mergedGenderFacetsSQL.replace("__WHERE__", genderWhere.where), genderWhere.params),
        client.query(activeFiltersSQL.replace("__WHERE__", priceWhere.where), priceWhere.params),
        resolvedCategoryId ? client.query(childCatsSql, [resolvedCategoryId]) : Promise.resolve({ rows: [] }),
      ]);

    const rowB = brandMerged.rows[0] || {};
    const rowC = colorMerged.rows[0] || {};
    const rowS = sizeMerged.rows[0] || {};
    const rowG = genderMerged.rows[0] || {};

    // Build grouped size data from the new size_counts with sizeType
    const rawSizeCounts = jsonAggRows(rowS.size_counts_json);
    const sizeGroupsMap = {};
    for (const sc of rawSizeCounts) {
      const grp = sc.sizeType || "Clothing";
      if (!sizeGroupsMap[grp]) sizeGroupsMap[grp] = [];
      sizeGroupsMap[grp].push({ value: sc.value, count: sc.count });
    }

    const responseData = {
      brands: rowB.brands || [],
      brand_counts: jsonAggRows(rowB.brand_counts_json),
      colors: rowC.colors || [],
      color_counts: jsonAggRows(rowC.color_counts_json),
      sizes: rowS.sizes || [],
      size_counts: rawSizeCounts,
      sizeGroups: sizeGroupsMap,
      sizeConversion: {
        clothing: { women: WOMEN_CLOTHING, men: MEN_CLOTHING },
        shoes: { women: WOMEN_SHOES, men: MEN_SHOES },
        alphaSortOrder: ALPHA_SORT_ORDER,
      },
      genders: rowG.genders || [],
      gender_counts: jsonAggRows(rowG.gender_counts_json),
      price: {
        min: Number(activeFiltersRes.rows[0].min_price || 0),
        max: Number(activeFiltersRes.rows[0].max_price || 0),
      },
      total: Number(activeFiltersRes.rows[0].total || 0),
      child_categories: childCatsRes.rows || [],
    };

    filterCache.set(cacheKey, responseData);
    return sendResponse(res, 200, true, "Filters fetched", responseData);
  } catch (err) {
    console.error("getDynamicFilters Error:", err);
    return next(new AppError(err.message || "Failed to load filters", 500));
  } finally {
    client.release();
  }
});

// module.exports.getProductsFromOurCategories = catchAsync(async (req, res, next) => {
//     const client = await dbPool.connect();
//     try {
//         const {
//             q,
//             category_id,
//             brand,
//             vendor_id,
//             min_price,
//             max_price,
//             color,
//             size,
//             gender,
//             country,
//             sku,
//             sort_by = "created_at",
//             sort_order = "desc",
//             page: pageQ,
//             limit: limitQ,
//             include = "variants,categories,filters,media"
//         } = req.query;

//         let dynamic_filters = [];
//         if (req.query.dynamic_filter) {
//             if (Array.isArray(req.query.dynamic_filter)) {
//                 dynamic_filters = req.query.dynamic_filter;
//             } else {
//                 dynamic_filters = String(req.query.dynamic_filter).split(",").map(s => s.trim());
//             }
//             dynamic_filters = dynamic_filters
//                 .map(df => {
//                     const [filter_type, ...rest] = df.split(":");
//                     const filter_name = rest.join(":");
//                     if (!filter_type || !filter_name) return null;
//                     return { filter_type: filter_type.trim(), filter_name: filter_name.trim() };
//                 })
//                 .filter(Boolean);
//         }

//         const page = Math.max(1, parseInt(pageQ, 10) || 1);
//         const limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
//         const offset = (page - 1) * limit;

//         if (vendor_id && !isValidUUID(vendor_id)) return next(new AppError("Invalid vendor_id", 400));
//         if (category_id && !isValidUUID(category_id)) return next(new AppError("Invalid category_id", 400));

//         const includeParts = new Set(include.split(",").map(s => s.trim()).filter(Boolean));

//         // ✅ Step 1: Find all vendor categories mapped to this "our category"
//         let vendorCategoryIds = null;

//         if (category_id) {
//             const mappedRes = await client.query(`
//                 SELECT id
//                 FROM categories
//                 WHERE our_category = $1 AND deleted_at IS NULL
//             `, [category_id]);

//             if (mappedRes.rowCount === 0) {
//                 return sendResponse(res, 200, true, "Products fetched", {
//                     total: 0,
//                     page,
//                     limit,
//                     total_pages: 1,
//                     products: []
//                 });
//             }

//             vendorCategoryIds = mappedRes.rows.map(r => r.id);
//         }

//         // ✅ Step 2: Prepare options for ProductService
//         const options = {
//             q,
//             category_id: category_id || null, // our_category is handled separately
//             vendor_category_ids: vendorCategoryIds, // mapped vendor category IDs
//             brand: brand || null,
//             vendor_id: vendor_id || null,
//             min_price: isNaN(Number(min_price)) ? null : Number(min_price),
//             max_price: isNaN(Number(max_price)) ? null : Number(max_price),
//             color: color || null,
//             size: size || null,
//             gender: gender || null,
//             country: country || null,
//             sku: sku || null,
//             dynamic_filters,
//             sort_by,
//             sort_order: sort_order.toLowerCase() === "asc" ? "asc" : "desc",
//             limit,
//             offset,
//             include: {
//                 variants: includeParts.has("variants"),
//                 categories: includeParts.has("categories"),
//                 filters: includeParts.has("filters"),
//                 media: includeParts.has("media")
//             }
//         };

//         // ✅ Step 3: Fetch products using ProductService
//         const { total, products } = await ProductService.getProductsFromOurCategory(options, client);

//         const totalPages = Math.max(1, Math.ceil(total / limit));

//         return sendResponse(res, 200, true, "Products fetched", {
//             total,
//             page,
//             limit,
//             total_pages: totalPages,
//             products
//         });
//     } catch (err) {
//         console.error("Error in getProductsFromOurCategories:", err);
//         return next(new AppError(err.message || "Failed to fetch products", 500));
//     } finally {
//         client.release();
//     }
// });

module.exports.getProductById = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.query.productId;

    if (!id || !isValidUUID(id)) {
      client.release();
      return next(new AppError("Invalid or missing product ID", 400));
    }

    const product = await ProductService.getProductById(id, client);
    if (!product) {
      client.release();
      return next(new AppError("Product not found", 404));
    }

    return sendResponse(
      res,
      200,
      true,
      "Product fetched successfully",
      product
    );
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch product", 500));
  } finally {
    client.release();
  }
});

module.exports.getProductByIdAdmin = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.query.productId;
    const includeDeleted = req.query.includeDeleted === "1" || req.query.includeDeleted === "true";

    if (!id || !isValidUUID(id)) {
      client.release();
      return next(new AppError("Invalid or missing product ID", 400));
    }

    const product = await ProductService.getProductByIdAdmin(id, client, { includeDeleted });
    if (!product) {
      client.release();
      return next(new AppError("Product not found", 404));
    }

    return sendResponse(
      res,
      200,
      true,
      "Product fetched successfully",
      product
    );
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch product", 500));
  } finally {
    client.release();
  }
});

module.exports.toggleProductFlag = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { product_id, field } = req.body;

    if (!product_id || !isValidUUID(product_id)) {
      return next(new AppError("Valid product_id is required", 400));
    }

    // Only allow these two fields to be toggled
    const ALLOWED = new Set(["is_our_picks", "is_newest"]);
    if (!ALLOWED.has(field)) {
      return next(
        new AppError("Invalid field. Allowed: is_our_picks, is_newest", 400)
      );
    }

    // Atomic toggle using SQL: set field = NOT field
    const sql = `
      UPDATE products
      SET ${field} = NOT COALESCE(${field}, false), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, name, ${field};
    `;

    const { rows } = await client.query(sql, [product_id]);
    if (!rows || rows.length === 0) {
      return next(new AppError("Product not found or deleted", 404));
    }

    return sendResponse(res, 200, true, "Product flag toggled", rows[0]);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.mapProductToOurCategory = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    let { product_ids, our_category_id } = req.body;

    if (!product_ids || !our_category_id)
      return next(
        new AppError("product_ids and our_category_id are required", 400)
      );

    // Normalize to array
    if (!Array.isArray(product_ids)) product_ids = [product_ids];

    // Validate UUIDs
    if (!isValidUUID(our_category_id))
      return next(new AppError("Invalid our_category_id format", 400));
    for (const id of product_ids) {
      if (!isValidUUID(id))
        return next(new AppError("Invalid product_id format", 400));
    }

    await client.query("BEGIN");

    // Verify that our_category_id exists and is our category
    const ourCat = await CategoryService.getCategoryById(
      our_category_id,
      client
    );
    if (!ourCat) return next(new AppError("Our category not found", 404));
    if (!ourCat.is_our_category)
      return next(
        new AppError('Target category is not marked as an "our" category', 400)
      );

    const mappedResults = [];

    for (const pid of product_ids) {
      const productRes = await client.query(
        "SELECT id, name, vendor_id FROM products WHERE id=$1 AND deleted_at IS NULL",
        [pid]
      );

      if (productRes.rowCount === 0)
        return next(new AppError(`Product not found: ${pid}`, 404));

      const existing = await client.query(
        "SELECT id FROM product_our_category_map WHERE product_id=$1 AND our_category_id=$2",
        [pid, our_category_id]
      );

      if (existing.rowCount > 0) continue; // already mapped

      const ins = await client.query(
        `INSERT INTO product_our_category_map (id, product_id, our_category_id)
                 VALUES (gen_random_uuid(), $1, $2)
                 RETURNING id, product_id, our_category_id`,
        [pid, our_category_id]
      );

      mappedResults.push(ins.rows[0]);
    }

    await client.query("COMMIT");

    return sendResponse(
      res,
      200,
      true,
      "Products mapped successfully",
      mappedResults
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.updateProductPrice = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { product_id, price, type, varient_id } = req.body;

    // Validations
    if (!product_id || !isValidUUID(product_id))
      return next(new AppError("Valid product_id is required", 400));
    if (!varient_id || !isValidUUID(varient_id))
      return next(new AppError("Valid varient_id is required", 400));
    if (!price || isNaN(price) || price <= 0)
      return next(new AppError("Valid price is required", 400));
    if (!type || !["mrp", "price"].includes(type))
      return next(new AppError("Type must be 'mrp' or 'price'", 400));

    const updatedProduct = await ProductService.updateProductPrice(
      product_id,
      type,
      varient_id,
      price,
      client
    );

    return sendResponse(
      res,
      200,
      true,
      "Product price updated",
      updatedProduct
    );
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.toggleProductStatus = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  const id = req.body.productId;

  try {
    if (!id) return next(new AppError("Product ID is required", 400));

    await client.query("BEGIN");

    // 1️⃣ Check if product exists and not deleted
    const checkRes = await client.query(
      `SELECT id, is_active FROM products WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (checkRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Product not found or already deleted", 404));
    }

    const product = checkRes.rows[0];
    const newStatus = !product.is_active; // toggle TRUE <-> FALSE

    // 2️⃣ Update product status
    await client.query(
      `UPDATE products
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`,
      [newStatus, id]
    );

    // 3️⃣ Update product variants
    await client.query(
      `UPDATE product_variants
       SET is_active = $1, updated_at = NOW()
       WHERE product_id = $2 AND deleted_at IS NULL`,
      [newStatus, id]
    );

    // 4️⃣ Update dynamic filters if exist
    await client.query(
      `UPDATE product_dynamic_filters
       SET is_active = $1
       WHERE product_id = $2 AND deleted_at IS NULL`,
      [newStatus, id]
    );

    // 5️⃣ Update media if exist
    await client.query(
      `UPDATE media
       SET is_active = $1
       WHERE variant_id IN (
         SELECT id FROM product_variants WHERE product_id = $2
       ) AND deleted_at IS NULL`,
      [newStatus, id]
    );

    await client.query("COMMIT");

    return sendResponse(
      res,
      200,
      true,
      `Product ${newStatus ? "enabled" : "disabled"} successfully`,
      {
        id,
        is_active: newStatus,
      }
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Toggle product failed:", err);
    return next(
      new AppError(err.message || "Failed to toggle product status", 500)
    );
  } finally {
    client.release();
  }
});

module.exports.updateProduct = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { product_id, product, variants } = req.body || {};
    if (!product_id || !isValidUUID(product_id)) {
      client.release();
      return next(new AppError("Valid product_id is required", 400));
    }
    const result = await ProductService.updateProductAdmin(
      product_id,
      { product: product || {}, variants: Array.isArray(variants) ? variants : [] },
      client
    );
    return sendResponse(res, 200, true, "Product updated (marked as manually edited)", result);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.generateOurDescription = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const productId = req.body?.productId || req.body?.product_id;
    if (!productId || !isValidUUID(productId)) {
      client.release();
      return next(new AppError("Valid productId is required", 400));
    }
    const product = await ProductService.getProductByIdAdmin(productId, client);
    if (!product) {
      client.release();
      return next(new AppError("Product not found", 404));
    }
    const hasDesc = (product.description || product.short_description || "").trim();
    if (!hasDesc) {
      client.release();
      return next(new AppError("Product has no description to rewrite", 400));
    }
    const result = await rewriteDescription(product);
    if (result && typeof result === "object" && result.suspicious === true) {
      const reason = result.reason || "Name and description describe different product types";
      await ProductService.markProductSuspicious(productId, reason, client);
      client.release();
      return next(new AppError(reason, 400));
    }
    const ourDesc = typeof result === "string" ? result : "";
    if (!ourDesc.trim()) {
      client.release();
      return next(new AppError("No description generated", 400));
    }
    await ProductService.updateOurDescription(productId, ourDesc, client);
    return sendResponse(res, 200, true, "Our description generated", { our_description: ourDesc });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.softDeleteProduct = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const product_id = req.body?.product_id || req.body?.productId || req.params?.id;
    if (!product_id || !isValidUUID(product_id)) {
      client.release();
      return next(new AppError("Valid product_id is required", 400));
    }
    const result = await ProductService.softDeleteProduct(product_id, client);
    return sendResponse(res, 200, true, "Product deleted (soft delete)", result);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

const BULK_ACTIONS = ["delete", "set_inactive", "set_active"];
const BULK_MAX_IDS = 200;

module.exports.bulkProductAction = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const product_ids = req.body?.product_ids;
    const action = (req.body?.action || "").toLowerCase();

    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      client.release();
      return next(new AppError("product_ids array is required and must not be empty", 400));
    }
    if (!BULK_ACTIONS.includes(action)) {
      client.release();
      return next(new AppError("action must be one of: delete, set_inactive, set_active", 400));
    }
    const ids = product_ids.filter((id) => typeof id === "string" && isValidUUID(id.trim()));
    if (ids.length === 0) {
      client.release();
      return next(new AppError("No valid product IDs provided", 400));
    }
    if (ids.length > BULK_MAX_IDS) {
      client.release();
      return next(new AppError(`Maximum ${BULK_MAX_IDS} products per request`, 400));
    }

    await client.query("BEGIN");

    if (action === "delete") {
      await client.query(
        "UPDATE product_variants SET deleted_at = NOW(), updated_at = NOW() WHERE product_id = ANY($1::uuid[]) AND deleted_at IS NULL",
        [ids]
      );
      await client.query(
        "UPDATE products SET deleted_at = NOW(), is_active = false, updated_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL",
        [ids]
      );
    } else {
      const isActive = action === "set_active";
      await client.query(
        "UPDATE products SET is_active = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL",
        [isActive, ids]
      );
      await client.query(
        "UPDATE product_variants SET is_active = $1, updated_at = NOW() WHERE product_id = ANY($2::uuid[]) AND deleted_at IS NULL",
        [isActive, ids]
      );
      await client.query(
        `UPDATE product_dynamic_filters SET is_active = $1 WHERE product_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [isActive, ids]
      );
      await client.query(
        `UPDATE media SET is_active = $1 WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ANY($2::uuid[])) AND deleted_at IS NULL`,
        [isActive, ids]
      );
    }

    await client.query("COMMIT");

    const message =
      action === "delete"
        ? `${ids.length} product(s) deleted`
        : action === "set_inactive"
          ? `${ids.length} product(s) set inactive`
          : `${ids.length} product(s) set active`;
    return sendResponse(res, 200, true, message, { count: ids.length, product_ids: ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.getDeletedOrSuspiciousProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = req.query.filter || "all"; // all | deleted | suspicious
    const { total, products } = await ProductService.getDeletedOrSuspiciousProducts(
      { page, limit, filter },
      client
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return sendResponse(res, 200, true, "Deleted/suspicious products", {
      products,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.recoverProduct = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const product_id = req.body?.product_id || req.body?.productId || req.params?.id;
    if (!product_id || !isValidUUID(product_id)) {
      client.release();
      return next(new AppError("Valid product_id is required", 400));
    }
    const result = await ProductService.recoverProduct(product_id, client);
    return sendResponse(res, 200, true, "Product recovered (sync can update again)", result);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

const BULK_RECOVER_MAX = 200;

module.exports.bulkRecoverProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const product_ids = req.body?.product_ids;
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      client.release();
      return next(new AppError("product_ids array is required and must not be empty", 400));
    }
    const ids = product_ids.filter((id) => typeof id === "string" && isValidUUID(id.trim()));
    if (ids.length === 0) {
      client.release();
      return next(new AppError("No valid product IDs provided", 400));
    }
    if (ids.length > BULK_RECOVER_MAX) {
      client.release();
      return next(new AppError(`Maximum ${BULK_RECOVER_MAX} products per request`, 400));
    }
    await client.query("BEGIN");
    await client.query(
      "UPDATE product_variants SET deleted_at = NULL, updated_at = NOW() WHERE product_id = ANY($1::uuid[])",
      [ids]
    );
    await client.query(
      `UPDATE products SET suspicious_at = NULL, suspicious_reason = NULL, deleted_at = NULL, is_active = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    await client.query("COMMIT");
    return sendResponse(res, 200, true, `${ids.length} product(s) recovered`, { count: ids.length, product_ids: ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /admin/quarantine-review-suggest
 * Body: { product_id }
 */
module.exports.quarantineReviewSuggest = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const productId = req.body?.product_id || req.body?.productId;
    if (!productId || !isValidUUID(productId)) {
      return next(new AppError("Valid product_id is required", 400));
    }

    const product = await ProductService.getProductByIdAdmin(productId, client, {
      includeDeleted: true,
    });
    if (!product) {
      return next(new AppError("Product not found", 404));
    }
    if (!product.suspicious_at) {
      return next(
        new AppError("Product is not quarantined (no suspicious flag)", 400)
      );
    }

    const suggestion = await suggestQuarantineFix(
      product,
      product.suspicious_reason || ""
    );

    return sendResponse(res, 200, true, "Suggestion generated", {
      product_id: productId,
      suspicious_reason: product.suspicious_reason,
      ...suggestion,
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /admin/quarantine-review-apply
 * Body: { product_id, product: { name?, title?, ... }, recover?: boolean }
 */
module.exports.quarantineReviewApply = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const productId = req.body?.product_id || req.body?.productId;
    const productPatch = req.body?.product || {};
    const recover =
      req.body?.recover !== false && req.body?.recover !== "false";

    if (!productId || !isValidUUID(productId)) {
      return next(new AppError("Valid product_id is required", 400));
    }
    if (!productPatch || typeof productPatch !== "object") {
      return next(
        new AppError("product object with fields to save is required", 400)
      );
    }

    await client.query("BEGIN");
    await ProductService.updateProductAdminForQuarantine(
      productId,
      { product: productPatch },
      client
    );
    let recovered = null;
    if (recover) {
      recovered = await ProductService.recoverProduct(productId, client);
    }
    await client.query("COMMIT");

    return sendResponse(
      res,
      200,
      true,
      recover ? "Saved and recovered" : "Saved",
      {
        product_id: productId,
        recovered: Boolean(recover),
        result: recovered,
      }
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.getCompetitorBlacklist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      "SELECT id, name, created_at FROM competitor_blacklist ORDER BY LOWER(name)"
    );
    return sendResponse(res, 200, true, "Competitor blacklist", { list: rows });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.addCompetitorBlacklist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const name = req.body?.name ? String(req.body.name).trim() : "";
    if (!name) {
      client.release();
      return next(new AppError("name is required", 400));
    }
    const { rows } = await client.query(
      "INSERT INTO competitor_blacklist (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id, name, created_at",
      [name]
    );
    const item = rows[0] || null;
    return sendResponse(res, 200, true, item ? "Added to blacklist" : "Already in blacklist", item);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.deleteCompetitorBlacklist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.params?.id;
    if (!id || !isValidUUID(id)) {
      client.release();
      return next(new AppError("Valid id is required", 400));
    }
    const { rowCount } = await client.query(
      "DELETE FROM competitor_blacklist WHERE id = $1",
      [id]
    );
    return sendResponse(res, 200, true, rowCount ? "Removed from blacklist" : "Not found", { deleted: rowCount > 0 });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.getMarginSettings = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const vendorId = req.query.vendor_id || null;
    let row = null;
    if (vendorId && isValidUUID(vendorId)) {
      const { rows } = await client.query(
        `SELECT id, vendor_id, high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent, updated_at
         FROM margin_settings WHERE vendor_id = $1 LIMIT 1`,
        [vendorId]
      );
      row = rows[0] || null;
    }
    if (!row) {
      const { rows } = await client.query(
        `SELECT id, vendor_id, high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent, updated_at
         FROM margin_settings WHERE vendor_id IS NULL LIMIT 1`
      );
      row = rows[0] || null;
    }
    const data = row
      ? {
          vendor_id: row.vendor_id,
          high_threshold: Number(row.high_threshold),
          mid_threshold: Number(row.mid_threshold),
          margin_high_percent: Number(row.margin_high_percent),
          margin_mid_percent: Number(row.margin_mid_percent),
          margin_low_percent: Number(row.margin_low_percent),
          updated_at: row.updated_at,
        }
      : null;
    return sendResponse(res, 200, true, "Margin settings", data);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.listMarginSettings = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT m.id, m.vendor_id, m.high_threshold, m.mid_threshold, m.margin_high_percent, m.margin_mid_percent, m.margin_low_percent, m.updated_at,
              v.name AS vendor_name
       FROM margin_settings m
       LEFT JOIN vendors v ON v.id = m.vendor_id
       ORDER BY m.vendor_id NULLS FIRST`
    );
    const list = rows.map((r) => ({
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name || "Default",
      high_threshold: Number(r.high_threshold),
      mid_threshold: Number(r.mid_threshold),
      margin_high_percent: Number(r.margin_high_percent),
      margin_mid_percent: Number(r.margin_mid_percent),
      margin_low_percent: Number(r.margin_low_percent),
      updated_at: r.updated_at,
    }));
    return sendResponse(res, 200, true, "Margin settings list", { list });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.updateMarginSettings = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      vendor_id: vendorId,
      high_threshold,
      mid_threshold,
      margin_high_percent,
      margin_mid_percent,
      margin_low_percent,
    } = req.body || {};
    const vId = vendorId && isValidUUID(vendorId) ? vendorId : null;
    const high = high_threshold != null && !Number.isNaN(Number(high_threshold)) ? Number(high_threshold) : null;
    const mid = mid_threshold != null && !Number.isNaN(Number(mid_threshold)) ? Number(mid_threshold) : null;
    const mHigh = margin_high_percent != null && !Number.isNaN(Number(margin_high_percent)) ? Number(margin_high_percent) : null;
    const mMid = margin_mid_percent != null && !Number.isNaN(Number(margin_mid_percent)) ? Number(margin_mid_percent) : null;
    const mLow = margin_low_percent != null && !Number.isNaN(Number(margin_low_percent)) ? Number(margin_low_percent) : null;

    const existing = await client.query(
      "SELECT id FROM margin_settings WHERE " + (vId ? "vendor_id = $1" : "vendor_id IS NULL") + " LIMIT 1",
      vId ? [vId] : []
    );
    const defaults = { high_threshold: 1000, mid_threshold: 501, margin_high_percent: 28, margin_mid_percent: 37, margin_low_percent: 45 };
    if (existing.rows.length) {
      const updates = [];
      const values = [];
      let idx = 1;
      if (high != null) { updates.push(`high_threshold = $${idx}`); values.push(high); idx++; }
      if (mid != null) { updates.push(`mid_threshold = $${idx}`); values.push(mid); idx++; }
      if (mHigh != null) { updates.push(`margin_high_percent = $${idx}`); values.push(mHigh); idx++; }
      if (mMid != null) { updates.push(`margin_mid_percent = $${idx}`); values.push(mMid); idx++; }
      if (mLow != null) { updates.push(`margin_low_percent = $${idx}`); values.push(mLow); idx++; }
      if (updates.length === 0) {
        client.release();
        return next(new AppError("At least one margin field is required", 400));
      }
      updates.push("updated_at = NOW()");
      values.push(existing.rows[0].id);
      await client.query(`UPDATE margin_settings SET ${updates.join(", ")} WHERE id = $${idx}`, values);
    } else {
      await client.query(
        `INSERT INTO margin_settings (vendor_id, high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [vId, high ?? defaults.high_threshold, mid ?? defaults.mid_threshold, mHigh ?? defaults.margin_high_percent, mMid ?? defaults.margin_mid_percent, mLow ?? defaults.margin_low_percent]
      );
    }
    const { getMarginSettings } = require("../../utils/marginHelper");
    const config = await getMarginSettings(client, vId);
    const data = {
      vendor_id: vId,
      high_threshold: config.highThreshold,
      mid_threshold: config.midThreshold,
      margin_high_percent: config.marginHigh,
      margin_mid_percent: config.marginMid,
      margin_low_percent: config.marginLow,
    };
    return sendResponse(res, 200, true, "Margin settings updated", data);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.applyMarginNow = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { getMarginSettings, computeTieredPricing } = require("../../utils/marginHelper");
    const vendorId = req.body?.vendor_id || null;
    const vId = vendorId && isValidUUID(vendorId) ? vendorId : null;

    const variantsRes = await client.query(
      `SELECT pv.id, pv.product_id, pv.vendorsaleprice, pv.vendormrp, p.vendor_id
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
       WHERE pv.deleted_at IS NULL
         AND pv.vendorsaleprice IS NOT NULL AND (pv.vendorsaleprice::numeric) > 0
         AND (($1 IS NOT NULL AND p.vendor_id = $1) OR ($1 IS NULL AND p.vendor_id IS NOT NULL))`,
      [vId]
    );
    const variants = variantsRes.rows;
    let updated = 0;
    let lastVendorId = null;
    let marginConfig = null;
    for (const v of variants) {
      const vid = v.vendor_id;
      if (vid !== lastVendorId) {
        marginConfig = await getMarginSettings(client, vid);
        lastVendorId = vid;
      }
      const salePrice = v.vendorsaleprice != null ? Number(v.vendorsaleprice) : null;
      const vendorMrp = v.vendormrp != null ? Number(v.vendormrp) : null;
      if (!salePrice || salePrice <= 0) continue;
      const { ourPrice, ourMrp } = computeTieredPricing(salePrice, vendorMrp, marginConfig);
      if (ourPrice == null) continue;
      await client.query(
        "UPDATE product_variants SET price = $1, mrp = $2, updated_at = NOW() WHERE id = $3",
        [ourPrice, ourMrp != null ? ourMrp : ourPrice, v.id]
      );
      updated += 1;
    }
    return sendResponse(res, 200, true, "Prices updated", { updated, total: variants.length });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

async function getCategoryWithParents(client, categoryId) {
  const query = `
        WITH RECURSIVE category_hierarchy AS (
            SELECT id, name, slug, parent_id
            FROM categories
            WHERE id = $1
            UNION ALL
            SELECT c.id, c.name, c.slug, c.parent_id
            FROM categories c
            INNER JOIN category_hierarchy ch ON ch.parent_id = c.id
        )
        SELECT * FROM category_hierarchy;
    `;
  const { rows } = await client.query(query, [categoryId]);
  if (!rows.length) return null;

  // rows are from child → parent order, we reverse to build hierarchy top-down
  const chain = rows.reverse();

  // build nested structure
  let nested = null;
  for (const c of chain) {
    nested = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      ...(nested ? { parent: nested } : {}),
    };
  }
  return nested;
}

module.exports.getMappedProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];

    let baseWhere = `p.deleted_at IS NULL AND oc.deleted_at IS NULL`;

    // 🔍 Search by product name, SKU, or category name
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      baseWhere += ` AND (
        LOWER(p.name) LIKE $${params.length} OR
        LOWER(p.title) LIKE $${params.length} OR
        LOWER(p.product_sku) LIKE $${params.length} OR
        LOWER(oc.name) LIKE $${params.length}
      )`;
    }

    /********************************************
     * 🧮 TOTAL COUNT
     ********************************************/
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM product_our_category_map pom
      JOIN products p ON pom.product_id = p.id
      JOIN categories oc ON pom.our_category_id = oc.id
      WHERE ${baseWhere}
    `;
    const totalRes = await client.query(countQuery, params);
    const total = parseInt(totalRes.rows[0].total, 10);

    /********************************************
     * 🧾 FETCH MAPPED PRODUCTS
     ********************************************/
    const query = `
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        p.product_sku AS sku,
        p.vendor_id,
        p.is_active,
        p.created_at AS product_created_at,
        oc.id AS our_category_id,
        oc.name AS our_category_name,
        oc.slug AS our_category_slug
      FROM product_our_category_map pom
      JOIN products p ON pom.product_id = p.id
      JOIN categories oc ON pom.our_category_id = oc.id
      WHERE ${baseWhere}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const { rows } = await client.query(query, params);

    console.log("Fetched mapped products:", rows);

    /********************************************
     * 🧩 ATTACH CATEGORY HIERARCHY
     ********************************************/
    const result = [];
    for (const row of rows) {
      const ourCategoryNested = await getCategoryWithParents(
        client,
        row.our_category_id
      );

      result.push({
        product_id: row.product_id,
        product_name: row.product_name,
        sku: row.sku,
        vendor_id: row.vendor_id,
        is_active: row.is_active,
        created_at: row.product_created_at,
        our_category: ourCategoryNested,
      });
    }

    const totalPages = Math.ceil(total / limit);

    return sendResponse(
      res,
      200,
      true,
      "Mapped products fetched successfully",
      {
        total,
        totalPages,
        currentPage: Number(page),
        data: result,
      }
    );
  } catch (err) {
    console.error("❌ Error in getMappedProducts:", err);
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.unmapProduct = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  const { product_id, our_category_id } = { ...req.query, ...req.body };

  try {
    if (!product_id || !our_category_id) {
      return next(
        new AppError("product_id and our_category_id are required", 400)
      );
    }

    await client.query("BEGIN");

    // 1️⃣ Check if mapping exists
    const check = await client.query(
      `
      SELECT id FROM product_our_category_map
      WHERE product_id = $1 AND our_category_id = $2
      `,
      [product_id, our_category_id]
    );

    if (check.rowCount === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Mapping not found", 404));
    }

    // 2️⃣ Delete mapping
    await client.query(
      `
      DELETE FROM product_our_category_map
      WHERE product_id = $1 AND our_category_id = $2
      `,
      [product_id, our_category_id]
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Product unmapped successfully", {
      product_id,
      our_category_id,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Error in unmapProduct:", err);
    return next(new AppError(err.message || "Failed to unmap product", 500));
  } finally {
    client.release();
  }
});

module.exports.updateProductPriceByVendorId = catchAsync(
  async (req, res, next) => {
    const client = await dbPool.connect();
    try {
      const { vendor_id, percentage } = req.body;

      if (!vendor_id || !isValidUUID(vendor_id)) {
        return next(new AppError("Valid vendor_id is required", 400));
      }

      const updatedProduct = await ProductService.updateProductPriceByVendorId(
        vendor_id,
        percentage,
        client
      );

      return sendResponse(
        res,
        200,
        true,
        "Product price updated",
        updatedProduct
      );
    } catch (err) {
      return next(err);
    } finally {
      client.release();
    }
  }
);

module.exports.getAllBrands = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  let { search, category_slug } = req.query;
  try {
    const allBrands = await ProductService.getAllBrands(search, category_slug, client);
    return sendResponse(
      res,
      200,
      true,
      "Brands fetched successfully",
      allBrands
    );
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

// ===============================================
// GET SIMILAR PRODUCTS
// ===============================================

module.exports.getSimilarProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const productId = req.query.productId;
    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    // ---------------------------------------------------------
    // 1) Fetch Base Product (ID, our categories, brand, gender, color)
    // ---------------------------------------------------------
    const baseSql = `
      SELECT
        p.id,
        p.brand_name,
        p.gender,
        p.attributes->>'color' AS color,
        (
          SELECT ARRAY_AGG(DISTINCT pom.our_category_id)
          FROM product_our_category_map pom
          WHERE pom.product_id = p.id
        ) AS our_category_ids,
        (
          SELECT MIN(v.price)
          FROM product_variants v
          WHERE v.product_id = p.id
            AND v.is_active = TRUE
            AND (v.stock > 0 OR v.stock IS NULL)
        ) AS base_price
      FROM products p
      WHERE p.id = $1::uuid
        AND p.deleted_at IS NULL
    `;
    const baseResult = await client.query(baseSql, [productId]);
    if (baseResult.rows.length === 0) {
      return next(new AppError("Product not found", 404));
    }

    const base = baseResult.rows[0];

    // ---------------------------------------------------------
    // 2) Fetch Similar Product IDs using scoring logic
    // ---------------------------------------------------------
    const similarSql = `
      WITH candidate_prices AS (
        SELECT
          pv.product_id,
          MIN(pv.price) AS min_price
        FROM product_variants pv
        WHERE pv.deleted_at IS NULL
          AND pv.is_active = TRUE
        GROUP BY pv.product_id
      ),
      base AS (
        SELECT
          $1::uuid AS id,
          $2::uuid[] AS our_category_ids,
          $3::text AS brand_name,
          $4::text AS gender,
          $5::text AS color,
          $6::numeric AS base_price
      )
      SELECT p.id
      FROM products p
      JOIN candidate_prices cp ON cp.product_id = p.id
      CROSS JOIN base b
      WHERE p.id <> b.id
        AND p.deleted_at IS NULL
        AND p.is_active = TRUE
        AND (p.vendor_id IS NULL OR EXISTS (
          SELECT 1 FROM vendors v
          WHERE v.id = p.vendor_id
            AND v.status = 'active'
            AND v.deleted_at IS NULL
        ))
      ORDER BY
        (
          (CASE
            WHEN b.our_category_ids IS NOT NULL AND EXISTS (
              SELECT 1 FROM product_our_category_map pom_s
              WHERE pom_s.product_id = p.id
                AND pom_s.our_category_id = ANY(b.our_category_ids)
            ) THEN 3
            ELSE 0
          END) +
          (CASE WHEN LOWER(p.brand_name) = LOWER(b.brand_name) THEN 2 ELSE 0 END) +
          (CASE WHEN LOWER(p.gender) = LOWER(b.gender) THEN 1 ELSE 0 END) +
          (CASE WHEN LOWER(p.attributes->>'color') = LOWER(b.color) THEN 1 ELSE 0 END)
        ) DESC,
        cp.min_price ASC
      LIMIT 4;
    `;

    const similarIdsResult = await client.query(similarSql, [
      base.id,
      base.our_category_ids,
      base.brand_name,
      base.gender,
      base.color,
      base.base_price,
    ]);

    const similarIds = similarIdsResult.rows.map((r) => r.id);
    if (similarIds.length === 0) {
      return sendResponse(res, 200, true, "Similar products", {
        products: [],
        count: 0,
      });
    }

    // ---------------------------------------------------------
    // 3) Fetch Full Similar Products With Variants + Media
    // ---------------------------------------------------------
    const fullSql = `
      SELECT
        p.*,

        -- VARIANTS
        (
          SELECT json_agg(v ORDER BY v.created_at)
          FROM (
            SELECT pv.*
            FROM product_variants pv
            WHERE pv.product_id = p.id
              AND pv.deleted_at IS NULL
          ) v
        ) AS variants,

        -- CATEGORIES
        (
          SELECT json_agg(c)
          FROM (
            SELECT DISTINCT c.id, c.name, c.slug, c.path
            FROM product_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.product_id = p.id
              AND pc.deleted_at IS NULL
              AND c.deleted_at IS NULL
          ) c
        ) AS categories,

        -- DYNAMIC FILTERS
        (
          SELECT json_agg(f)
          FROM (
            SELECT DISTINCT
              pdf.filter_type,
              pdf.filter_name
            FROM product_dynamic_filters pdf
            WHERE pdf.product_id = p.id
              AND pdf.deleted_at IS NULL
          ) f
        ) AS dynamic_filters

      FROM products p
      WHERE p.id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], p.id);
    `;

    const productsResult = await client.query(fullSql, [similarIds]);

    // return res.json({
    //   success: true,
    //   count: productsResult.rows.length,
    //   data: productsResult.rows,
    // });
    return sendResponse(res, 200, true, "Similar products", {
      products: productsResult.rows,
      count: productsResult.rows.length,
    });
  } catch (err) {
    console.error("getSimilarProducts error", err);
    return next(new AppError("Internal server error", 500));
  } finally {
    client.release();
  }
});

// ===============================================
// CUSTOM DUTIES (per currency for frontend display)
// ===============================================

const CUSTOM_DUTY_CURRENCIES = ["AED", "SAR", "QAR", "KWD", "OMR", "BHD", "INR", "PKR"];

module.exports.getCustomDuties = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT currency_code, duty_percent, updated_at FROM custom_duties ORDER BY currency_code`
    );
    const duties = {};
    rows.forEach((r) => {
      duties[r.currency_code] = Number(r.duty_percent) || 0;
    });
    // Ensure all operating currencies have a key (default 0)
    CUSTOM_DUTY_CURRENCIES.forEach((code) => {
      if (!(code in duties)) duties[code] = 0;
    });
    return sendResponse(res, 200, true, "Custom duties", duties);
  } finally {
    client.release();
  }
});

module.exports.updateCustomDuties = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const duties = req.body.duties;
    if (!duties || typeof duties !== "object") {
      return next(new AppError("duties object is required", 400));
    }
    for (const code of Object.keys(duties)) {
      if (!CUSTOM_DUTY_CURRENCIES.includes(code)) continue;
      const pct = Number(duties[code]);
      const value = Number.isNaN(pct) || pct < 0 ? 0 : Math.min(100, pct);
      await client.query(
        `INSERT INTO custom_duties (currency_code, duty_percent, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (currency_code) DO UPDATE SET duty_percent = $2, updated_at = now()`,
        [code, value]
      );
    }
    const { rows } = await client.query(
      `SELECT currency_code, duty_percent FROM custom_duties ORDER BY currency_code`
    );
    const result = {};
    rows.forEach((r) => {
      result[r.currency_code] = Number(r.duty_percent) || 0;
    });
    CUSTOM_DUTY_CURRENCIES.forEach((code) => {
      if (!(code in result)) result[code] = 0;
    });
    return sendResponse(res, 200, true, "Custom duties updated", result);
  } finally {
    client.release();
  }
});

// module.exports.getSimilarProducts = catchAsync(async (req, res, next) => {
//   const client = await dbPool.connect();

//   try {
//     const productId = req.query.productId;
//     if (!productId) {
//       return next(new AppError("Product ID is required", 400));
//     }

//     // 1) Fetch Base Product
//     const baseSql = `
//       SELECT
//         p.id,
//         p.default_category_id,
//         p.brand_name,
//         p.gender,
//         p.attributes->>'color' AS color,
//         (
//           SELECT MIN(COALESCE(v.sale_price, v.price))
//           FROM product_variants v
//           WHERE v.product_id = p.id
//             AND v.is_active = TRUE
//             AND (v.stock > 0 OR v.stock IS NULL)
//         ) AS base_price
//       FROM products p
//       WHERE p.id = $1::uuid
//         AND p.deleted_at IS NULL
//     `;
//     const baseResult = await client.query(baseSql, [productId]);

//     if (baseResult.rows.length === 0) {
//       return next(new AppError("Product not found", 404));
//     }

//     const base = baseResult.rows[0];

//     // 2) Similar IDs
//     const similarSql = `
//       WITH candidate_prices AS (
//         SELECT
//           pv.product_id,
//           MIN(COALESCE(pv.sale_price, pv.price)) AS min_price
//         FROM product_variants pv
//         WHERE pv.deleted_at IS NULL
//           AND pv.is_active = TRUE
//         GROUP BY pv.product_id
//       ),
//       base AS (
//         SELECT
//           $1::uuid AS id,
//           $2::uuid AS default_category_id,
//           $3::text AS brand_name,
//           $4::text AS gender,
//           $5::text AS color,
//           $6::numeric AS base_price
//       )
//       SELECT p.id
//       FROM products p
//       JOIN candidate_prices cp ON cp.product_id = p.id
//       CROSS JOIN base b
//       WHERE p.id <> b.id
//         AND p.deleted_at IS NULL
//         AND p.is_active = TRUE
//       ORDER BY
//         (
//           (CASE WHEN p.default_category_id = b.default_category_id THEN 3 ELSE 0 END) +
//           (CASE WHEN LOWER(p.brand_name) = LOWER(b.brand_name) THEN 2 ELSE 0 END) +
//           (CASE WHEN LOWER(p.gender) = LOWER(b.gender) THEN 1 ELSE 0 END) +
//           (CASE WHEN LOWER(p.attributes->>'color') = LOWER(b.color) THEN 1 ELSE 0 END)
//         ) DESC,
//         cp.min_price ASC
//       LIMIT 4;
//     `;

//     const similarIdsResult = await client.query(similarSql, [
//       base.id,
//       base.default_category_id,
//       base.brand_name,
//       base.gender,
//       base.color,
//       base.base_price,
//     ]);

//     const similarIds = similarIdsResult.rows.map((r) => r.id);

//     if (similarIds.length === 0) {
//       return sendResponse(res, 200, true, "Similar products", {
//         products: [],
//         count: 0,
//       });
//     }

//     // 3) Full Product Data
//     const fullSql = `
//       SELECT
//         p.*,

//         (SELECT json_agg(v ORDER BY v.created_at)
//          FROM (
//            SELECT pv.* FROM product_variants pv
//            WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
//          ) v
//         ) AS variants,

//         (SELECT json_agg(c)
//          FROM (
//            SELECT DISTINCT c.id, c.name, c.slug, c.path
//            FROM product_categories pc
//            JOIN categories c ON c.id = pc.category_id
//            WHERE pc.product_id = p.id
//              AND pc.deleted_at IS NULL
//              AND c.deleted_at IS NULL
//          ) c
//         ) AS categories,

//         (SELECT json_agg(f)
//          FROM (
//            SELECT DISTINCT pdf.filter_type, pdf.filter_name
//            FROM product_dynamic_filters pdf
//            WHERE pdf.product_id = p.id AND pdf.deleted_at IS NULL
//          ) f
//         ) AS dynamic_filters

//       FROM products p
//       WHERE p.id = ANY($1::uuid[])
//       ORDER BY array_position($1::uuid[], p.id);
//     `;

//     const productsResult = await client.query(fullSql, [similarIds]);

//     return sendResponse(res, 200, true, "Similar products", {
//       products: productsResult.rows,
//       count: productsResult.rows.length,
//     });
//   } catch (err) {
//     console.error("getSimilarProducts error", err);
//     return next(new AppError("Internal server error", 500));
//   } finally {
//     // 🔥 SAFE — ALWAYS only ONE release
//     client.release();
//   }
// });
