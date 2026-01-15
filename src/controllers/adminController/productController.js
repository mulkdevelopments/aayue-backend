const catchAsync = require("../../errorHandling/catchAsync");
const ProductService = require("../../services/productService");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");
const CategoryService = require("../../services/categoryService");

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
    } = req.query;

    console.log(sort_by, sort_order, "1111111111111");

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

    const { total, products } = await ProductService.getProducts(
      options,
      client
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return sendResponse(res, 200, true, "Products fetched", {
      total,
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
    console.log("entering");
    const client = await dbPool.connect();
    try {
      const {
        q,
        category_id,
        category_slug,
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

      // ✅ If category_slug is provided, look up category_id by exact slug match
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

      // ✅ Parse multi-select filters
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

      // ✅ Decode JWT if available (for wishlist)
      let user_id = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        let token = authHeader.split(" ")[1];
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          console.log("Decoded JWT for wishlist:", decoded);
          user_id = decoded.id || decoded.user_id || decoded.userId; // support both naming styles
          console.log("Decoded user_id for wishlist:", user_id);
        } catch (err) {
          console.log("Invalid JWT token for wishlist check:", err.message);
          user_id = null;
        }
      }

      const options = {
        q,
        category_id: resolvedCategoryId,
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
        user_id, // ✅ pass user_id for wishlist check
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
      vendor_id,
      brand,
      size,
      color,
      min_price,
      max_price,
      q,
    } = req.query;

    if (category_id && !isValidUUID(category_id)) {
      return next(new AppError("Invalid category_id", 400));
    }
    if (vendor_id && !isValidUUID(vendor_id)) {
      return next(new AppError("Invalid vendor_id", 400));
    }

    const brands = Array.isArray(brand) ? brand : brand ? [brand] : [];
    const sizes = Array.isArray(size) ? size : size ? [size] : [];
    const colors = Array.isArray(color) ? color : color ? [color] : [];

    /** STEP-1: Resolve mapped vendor category IDs */
    let vendorCategoryIds = [];

    if (category_id) {
      const ourCats = await client.query(
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
        [category_id]
      );

      const ourCatIds = ourCats.rows.map((r) => r.id);

      const vendorMapped = await client.query(
        `SELECT id FROM categories WHERE is_our_category = false AND deleted_at IS NULL AND our_category = ANY($1)`,
        [ourCatIds]
      );

      const mappedVendorIds = vendorMapped.rows.map((r) => r.id);

      if (mappedVendorIds.length > 0) {
        const vendorDesc = await client.query(
          `
            WITH RECURSIVE vendor_descendants AS (
                SELECT id FROM categories WHERE id = ANY($1)
                UNION ALL
                SELECT c.id FROM categories c
                JOIN vendor_descendants vd ON c.parent_id = vd.id
                WHERE c.deleted_at IS NULL
            )
            SELECT DISTINCT id FROM vendor_descendants;
          `,
          [mappedVendorIds]
        );

        vendorCategoryIds = vendorDesc.rows.map((r) => r.id);
      }
    }

    /** STEP-2: Base WHERE */
    let baseParams = [];
    let baseWhere = "p.deleted_at IS NULL";

    if (vendorCategoryIds.length > 0) {
      baseParams.push(vendorCategoryIds);
      baseWhere += ` AND EXISTS (
            SELECT 1 FROM product_categories pc
            WHERE pc.product_id = p.id AND pc.category_id = ANY($${baseParams.length})
        )`;
    }

    if (vendor_id) {
      baseParams.push(vendor_id);
      baseWhere += ` AND p.vendor_id = $${baseParams.length}`;
    }

    /** STEP-3: Active Filters for price + search */
    let params = [...baseParams];
    let filterWhere = baseWhere;

    if (brands.length > 0) {
      params.push(brands);
      filterWhere += ` AND p.brand_name = ANY($${params.length})`;
    }

    if (sizes.length > 0) {
      params.push(sizes);
      filterWhere += ` AND pv.normalized_size_final = ANY($${params.length})`;
    }

    if (colors.length > 0) {
      params.push(colors);
      filterWhere += ` AND pv.normalized_color = ANY($${params.length})`;
    }

    if (min_price) {
      params.push(Number(min_price));
      filterWhere += ` AND pv.price >= $${params.length}`;
    }

    if (max_price) {
      params.push(Number(max_price));
      filterWhere += ` AND pv.price <= $${params.length}`;
    }

    /** 🔥 SEARCH FILTER — Only affects price calculation, not brand/color/size list */
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      filterWhere += `
        AND (
          LOWER(p.name) LIKE $${params.length} OR
          LOWER(p.brand_name) LIKE $${params.length} OR
          LOWER(p.short_description) LIKE $${params.length} OR
          LOWER(p.description) LIKE $${params.length} OR
          LOWER(pv.variant_size) LIKE $${params.length} OR
          LOWER(pv.normalized_color) LIKE $${params.length}
        )
      `;
    }

    /** STEP-4: Full filter set from category only (NO q applied) */
    const allFiltersSQL = `
      SELECT
          ARRAY_AGG(DISTINCT p.brand_name) FILTER (WHERE p.brand_name IS NOT NULL) AS brands,
          ARRAY_AGG(DISTINCT pv.normalized_color) FILTER (WHERE pv.normalized_color IS NOT NULL) AS colors,
          ARRAY_AGG(DISTINCT pv.variant_size) FILTER (WHERE pv.variant_size IS NOT NULL) AS sizes
      FROM products p
      INNER JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      WHERE ${baseWhere};
    `;

    /** STEP-5: Price range affected by q + filters */
    const activeFiltersSQL = `
      SELECT
          MIN(pv.price) AS min_price,
          MAX(pv.price) AS max_price
      FROM products p
      INNER JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      WHERE ${filterWhere};
    `;

    const [allFiltersRes, activeFiltersRes] = await Promise.all([
      client.query(allFiltersSQL, baseParams),
      client.query(activeFiltersSQL, params),
    ]);

    let childCats = [];
    if (category_id) {
      const subRes = await client.query(
        `SELECT id, name, slug FROM categories WHERE parent_id = $1 AND is_our_category = true AND deleted_at IS NULL`,
        [category_id]
      );
      childCats = subRes.rows;
    }

    return sendResponse(res, 200, true, "Filters fetched", {
      brands: allFiltersRes.rows[0].brands || [],
      colors: allFiltersRes.rows[0].colors || [],
      sizes: allFiltersRes.rows[0].sizes || [],
      price: {
        min: Number(activeFiltersRes.rows[0].min_price || 0),
        max: Number(activeFiltersRes.rows[0].max_price || 0),
      },
      child_categories: childCats,
    });
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

    if (!id || !isValidUUID(id)) {
      client.release();
      return next(new AppError("Invalid or missing product ID", 400));
    }

    const product = await ProductService.getProductByIdAdmin(id, client);
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
  const { product_id, our_category_id } = req.query;

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
  let { search } = req.query;
  try {
    const allBrands = await ProductService.getAllBrands(search, client);
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
    // 1) Fetch Base Product (ID, category, brand, gender, color)
    // ---------------------------------------------------------
    const baseSql = `
      SELECT
        p.id,
        p.default_category_id,
        p.brand_name,
        p.gender,
        p.attributes->>'color' AS color,
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
          $2::uuid AS default_category_id,
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
          (CASE WHEN p.default_category_id = b.default_category_id THEN 3 ELSE 0 END) +
          (CASE WHEN LOWER(p.brand_name) = LOWER(b.brand_name) THEN 2 ELSE 0 END) +
          (CASE WHEN LOWER(p.gender) = LOWER(b.gender) THEN 1 ELSE 0 END) +
          (CASE WHEN LOWER(p.attributes->>'color') = LOWER(b.color) THEN 1 ELSE 0 END)
        ) DESC,
        cp.min_price ASC
      LIMIT 4;
    `;

    const similarIdsResult = await client.query(similarSql, [
      base.id,
      base.default_category_id,
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
