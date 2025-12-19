// services/productService.js
const { v4: uuidv4 } = require("uuid");
const { Client } = require("@elastic/elasticsearch");


function toJsonb(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch (e) {
      return JSON.stringify(value);
    }
  }
  try {
    return JSON.stringify(value);
  } catch (e) {
    return JSON.stringify(String(value));
  }
}

const esClient = new Client({
  node: process.env.ES_NODE_URL || "http://localhost:9200",
  // auth / apiKey agar chahiye to yahan add kar:
  // auth: { username: process.env.ES_USER, password: process.env.ES_PASS }
});

// ✅ Helper: ElasticSearch full-text search
async function searchProductsInElastic({ q }) {
  console.log("ElasticSearch query:", q);
  if (!q) return null;

  try {
    const esRes = await esClient.search({
      index: process.env.ES_PRODUCTS_INDEX || "products",
      size: 10000, // max documents we are willing to consider before DB filters
      query: {
        multi_match: {
          query: q,
          fields: [
            "name^4",
            "title^3",
            "description",
            "brand_name^2",
            "categories.name^2",
            "categories.path^2",
            "variants.sku^5",
          ],
          type: "best_fields",
          operator: "and",
        },
      },
      _source: ["id"],
    });

    // v7/v8 dono ke saath safe parsing
    const hitsContainer = esRes.hits || esRes.body?.hits || {};
    const hits = hitsContainer.hits || [];
    const ids = hits.map((h) => h._source.id);
    const totalRaw = hitsContainer.total;
    const total =
      typeof totalRaw === "number" ? totalRaw : totalRaw?.value || ids.length;
    console.log(`ElasticSearch found ${total} matching products`);

    return { ids, total };
  } catch (err) {
    console.error("ElasticSearch search error:", err);
    // null return karega to hum SQL ILIKE fallback use karenge
    return null;
  }
}

const ProductService = {
  /**
   * productData: { product, variants = [], category_ids = [], dynamic_filters = [] }
   * client: pg client (transactionally controlled by caller)
   */
  async createProduct(productData, client) {
    const {
      product,
      variants = [],
      category_ids = [],
      dynamic_filters = [],
    } = productData;
    const productId = uuidv4();

    // === Product INSERT ===
    const productInsertText = `
      INSERT INTO products (
        id, vendor_id, productid, product_sku, productpartnersku, name, title,
        short_description, description, brand_name, gender, default_category_id,
        attributes, product_meta, sizechart_text, sizechart_image,
        shipping_returns_payments, environmental_impact, product_img, videos,
        delivery_time, cod_available, supplier, country_of_origin, is_active, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13::jsonb, $14::jsonb, $15, $16,
        $17::jsonb, $18::jsonb, $19, $20::jsonb,
        $21, $22, $23, $24, $25, now(), now()
      ) RETURNING *
    `;

    const productInsertValues = [
      productId, // $1
      product.vendor_id || null, // $2
      product.productid || null, // $3
      product.product_sku || null, // $4
      product.productpartnersku || null, // $5
      product.name, // $6
      product.title || null, // $7
      product.short_description || null, // $8
      product.description || null, // $9
      product.brand_name || null, // $10
      product.gender || null, // $11
      product.default_category_id || null, // $12
      toJsonb(product.attributes || null), // $13 ::jsonb
      toJsonb(product.product_meta || null), // $14 ::jsonb
      product.sizechart_text || null, // $15
      product.sizechart_image || null, // $16
      toJsonb(product.shipping_returns_payments || null), // $17 ::jsonb
      toJsonb(product.environmental_impact || null), // $18 ::jsonb
      product.product_img || null, // $19
      toJsonb(product.videos || null), // $20 ::jsonb
      product.delivery_time || null, // $21
      product.cod_available !== undefined ? product.cod_available : false, // $22
      product.supplier || null, // $23
      product.country_of_origin || null, // $24
      product.is_active !== undefined ? product.is_active : true, // $25
    ];

    const { rows: productRows } = await client.query(
      productInsertText,
      productInsertValues
    );
    const createdProduct = productRows[0];

    // === Validate duplicate SKUs before inserting variants ===
    for (const v of variants) {
      if (!v.sku) throw new Error("Each variant must have a sku");
      const { rows: existing } = await client.query(
        "SELECT id FROM product_variants WHERE sku = $1 AND deleted_at IS NULL",
        [v.sku]
      );
      if (existing.length > 0) {
        throw new Error(`Variant SKU already exists: ${v.sku}`);
      }
    }

    // === Variant INSERT (placeholders and values strictly matched) ===
    const createdVariants = [];
    for (const v of variants) {
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
        ) RETURNING *
      `;

      // Note: make sure we supply 32 values matching $1..$32
      const variantValues = [
        variantId, // $1
        productId, // $2
        v.sku, // $3
        v.barcode || null, // $4
        product.vendor_id ? v.vendor_product_id || null : null, // $5
        product.vendor_id ? v.productpartnersku || null : null, // $6
        v.price, // $7
        v.mrp || null, // $8
        v.sale_price || null, // $9
        v.stock || 0, // $10
        v.weight || null, // $11
        toJsonb(v.dimension || null), // $12 ::jsonb
        v.length || null, // $13
        v.width || null, // $14
        v.height || null, // $15
        toJsonb(v.attributes || null), // $16 ::jsonb
        toJsonb(v.images || null), // $17 ::jsonb
        toJsonb(v.image_urls || null), // $18 ::jsonb
        v.video1 || null, // $19
        v.video2 || null, // $20
        product.vendor_id ? v.vendormrp || null : null, // $21
        product.vendor_id ? v.vendorsaleprice || null : null, // $22
        v.ourmrp || null, // $23
        v.oursaleprice || null, // $24
        toJsonb(v.tax || null), // $25 ::jsonb
        v.tax1 || null, // $26
        v.tax2 || null, // $27
        v.tax3 || null, // $28
        v.variant_color || null, // $29
        v.variant_size || null, // $30
        v.country_of_origin || null, // $31
        v.is_active !== undefined ? v.is_active : true, // $32
      ];

      // Defensive check: ensure lengths match
      if (variantValues.length !== 32) {
        throw new Error(
          `Internal error: variantValues length ${variantValues.length} != 32`
        );
      }

      const { rows: varRows } = await client.query(
        variantInsertText,
        variantValues
      );
      const createdVar = varRows[0];
      createdVariants.push(createdVar);

      // inventory transaction for initial stock
      if (v.stock && Number(v.stock) > 0) {
        await client.query(
          `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
           VALUES ($1,$2,$3,$4,$5, now())`,
          [uuidv4(), variantId, v.stock, "initial_stock", null]
        );
      }
    }

    // === product_categories mapping ===
    const createdProductCategories = [];
    if (Array.isArray(category_ids) && category_ids.length > 0) {
      for (const catId of category_ids) {
        const mappingId = uuidv4();
        await client.query(
          `INSERT INTO product_categories (id, product_id, category_id) VALUES ($1,$2,$3)`,
          [mappingId, productId, catId]
        );
        createdProductCategories.push({
          id: mappingId,
          product_id: productId,
          category_id: catId,
        });
      }
    }

    // === dynamic filters ===
    const createdDynamicFilters = [];
    if (Array.isArray(dynamic_filters) && dynamic_filters.length > 0) {
      for (const df of dynamic_filters) {
        const dfId = uuidv4();
        await client.query(
          `INSERT INTO product_dynamic_filters (id, product_id, filter_type, filter_name) VALUES ($1,$2,$3,$4)`,
          [dfId, productId, df.filter_type, df.filter_name]
        );
        createdDynamicFilters.push({
          id: dfId,
          product_id: productId,
          filter_type: df.filter_type,
          filter_name: df.filter_name,
        });
      }
    }

    return {
      product: createdProduct,
      variants: createdVariants,
      product_categories: createdProductCategories,
      dynamic_filters: createdDynamicFilters,
    };
  },
  async getProducts(options, client) {
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
      dynamic_filters = [],
      sort_by = "created_at",
      sort_order = "desc",
      limit = 20,
      offset = 0,
      include = {
        variants: true,
        categories: true,
        filters: true,
        media: true,
      },
    } = options;

    // ---------- Build base WHERE clauses (only referencing products and EXISTS subqueries) ----------
    const whereClauses = ["p.deleted_at IS NULL"];
    const params = [];
    let idx = 1;

    if (q) {
      const qPattern = `%${q}%`;
      params.push(qPattern, qPattern, qPattern, qPattern, qPattern, qPattern);
      whereClauses.push(`(
                p.name ILIKE $${idx} OR
                p.title ILIKE $${idx + 1} OR
                p.description ILIKE $${idx + 2} OR
                p.brand_name ILIKE $${idx + 3} OR
                EXISTS (
                  SELECT 1 FROM product_variants pv_search
                  WHERE pv_search.product_id = p.id
                    AND pv_search.sku ILIKE $${idx + 4}
                    AND pv_search.deleted_at IS NULL
                ) OR
                EXISTS (
                  SELECT 1 FROM product_categories pc_search
                  JOIN categories c_search ON c_search.id = pc_search.category_id
                  WHERE pc_search.product_id = p.id
                    AND c_search.deleted_at IS NULL
                    AND c_search.name ILIKE $${idx + 5}
                )
            )`);
      idx += 6;
    }

    if (brand) {
      params.push(brand);
      whereClauses.push(`p.brand_name = $${idx}`);
      idx++;
    }

    if (vendor_id) {
      params.push(vendor_id);
      whereClauses.push(`p.vendor_id = $${idx}`);
      idx++;
    }

    if (sku) {
      params.push(sku);
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv_x WHERE pv_x.product_id = p.id AND pv_x.sku = $${idx} AND pv_x.deleted_at IS NULL)`
      );
      idx++;
    }

    if (gender) {
      params.push(gender);
      whereClauses.push(`p.gender = $${idx}`);
      idx++;
    }

    if (country) {
      params.push(country);
      whereClauses.push(`p.country_of_origin = $${idx}`);
      idx++;
    }

    if (min_price !== null && min_price !== undefined) {
      params.push(min_price);
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv_price WHERE pv_price.product_id = p.id AND (COALESCE(pv_price.sale_price, pv_price.price) >= $${idx}) AND pv_price.deleted_at IS NULL)`
      );
      idx++;
    }
    if (max_price !== null && max_price !== undefined) {
      params.push(max_price);
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv_price2 WHERE pv_price2.product_id = p.id AND (COALESCE(pv_price2.sale_price, pv_price2.price) <= $${idx}) AND pv_price2.deleted_at IS NULL)`
      );
      idx++;
    }

    if (color) {
      params.push(color);
      // whereClauses.push(`EXISTS (SELECT 1 FROM product_variants pv_c WHERE pv_c.product_id = p.id AND (pv_c.variant_color = $${idx} OR (pv_c.attributes->>'color') = $${idx}) AND pv_c.deleted_at IS NULL)`);
      // idx++;
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv_c WHERE pv_c.product_id = p.id AND (pv_c.normalized_color = $${idx} OR (pv_c.attributes->>'color') = $${idx}) AND pv_c.deleted_at IS NULL)`
      );
      idx++;
    }
    if (size) {
      params.push(size);
      // whereClauses.push(`EXISTS (SELECT 1 FROM product_variants pv_s WHERE pv_s.product_id = p.id AND (pv_s.variant_size = $${idx} OR (pv_s.attributes->>'size') = $${idx}) AND pv_s.deleted_at IS NULL)`);
      // idx++;
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv_s WHERE pv_s.product_id = p.id AND (pv_s.normalized_size = $${idx} OR (pv_s.attributes->>'size') = $${idx}) AND pv_s.deleted_at IS NULL)`
      );
      idx++;
    }

    // dynamic filters
    if (Array.isArray(dynamic_filters) && dynamic_filters.length > 0) {
      for (const df of dynamic_filters) {
        if (!df.filter_type || !df.filter_name) continue;
        params.push(df.filter_type);
        params.push(df.filter_name);
        whereClauses.push(
          `EXISTS (SELECT 1 FROM product_dynamic_filters pdf WHERE pdf.product_id = p.id AND pdf.filter_type = $${idx} AND pdf.filter_name = $${idx + 1
          } AND pdf.deleted_at IS NULL)`
        );
        idx += 2;
      }
    }

    // category subtree filter (keep as you had it but only used in base where)
    if (category_id) {
      const catRes = await client.query(
        `SELECT path FROM categories WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [category_id]
      );
      if (catRes.rowCount === 0) {
        return { total: 0, products: [] };
      }
      const parentPathRaw = catRes.rows[0].path || "";
      const parentPath = parentPathRaw.toLowerCase();
      params.push(parentPath);
      params.push(`${parentPath}/%`);
      whereClauses.push(`(
                EXISTS (
                  SELECT 1 FROM product_categories pc_sub
                  JOIN categories c_sub ON c_sub.id = pc_sub.category_id
                  WHERE pc_sub.product_id = p.id
                    AND c_sub.deleted_at IS NULL
                    AND (lower(c_sub.path) = $${idx} OR lower(c_sub.path) LIKE $${idx + 1
        })
                )
                OR
                EXISTS (
                  SELECT 1 FROM categories c_def
                  WHERE p.default_category_id = c_def.id
                    AND c_def.deleted_at IS NULL
                    AND (lower(c_def.path) = $${idx} OR lower(c_def.path) LIKE $${idx + 1
        })
                )
            )`);
      idx += 2;
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // ----------------- FAST COUNT on filtered products -----------------
    const countSQL = `SELECT COUNT(*)::int AS total FROM products p ${whereSQL}`;
    const countRes = await client.query(countSQL, params);
    const total = parseInt(countRes.rows[0].total, 10) || 0;
    if (total === 0) return { total: 0, products: [] };

    // ----------------- SELECT filtered product IDs (with ordering) -----------------
    // For sort_by=price we compute min price via correlated subquery (cheap here since only filtered rows are scanned and limited)
    const baseParamsForIds = params.slice(); // copy
    // building order expression and extra projection for sorting
    let orderExpr = `p.created_at ${sort_order === "asc" ? "ASC" : "DESC"}`;
    let selectExtra = ""; // to fetch min_price when needed
    if (sort_by === "price") {
      selectExtra = `(
                SELECT MIN(COALESCE(pv2.sale_price, pv2.price))
                FROM product_variants pv2
                WHERE pv2.product_id = p.id AND pv2.deleted_at IS NULL
            ) AS min_price`;
      orderExpr = `min_price ${sort_order === "asc" ? "ASC" : "DESC"}`;
    } else if (sort_by === "name") {
      orderExpr = `p.name ${sort_order === "asc" ? "ASC" : "DESC"}`;
    }

    const idsSQL = `
          SELECT p.id ${selectExtra ? ", " + selectExtra : ""}
          FROM products p
          ${whereSQL}
          ORDER BY ${orderExpr}
          LIMIT $${baseParamsForIds.length + 1} OFFSET $${baseParamsForIds.length + 2
      }
        `;
    baseParamsForIds.push(limit);
    baseParamsForIds.push(offset);

    const idsRes = await client.query(idsSQL, baseParamsForIds);
    const ids = idsRes.rows.map((r) => r.id);
    if (ids.length === 0) return { total: 0, products: [] };

    // ----------------- AGGREGATE only for selected ids -----------------
    // Build aggregates (same as before but executed only for filtered ids)
    const aggVariants = include.variants
      ? `COALESCE(jsonb_agg(DISTINCT to_jsonb(
                jsonb_build_object(
                  'id', pv.id,
                  'sku', pv.sku,
                  'price', pv.price,
                  'mrp', pv.mrp,
                  'sale_price', pv.sale_price,
                  'stock', pv.stock,
                  'variant_color', pv.variant_color,
                  'variant_size', pv.variant_size,
                  'images', pv.images,
                  'attributes', pv.attributes,
                  'country_of_origin', pv.country_of_origin
                )
             ) ) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants,`
      : `'[]'::jsonb AS variants,`;

    const aggCategories = include.categories
      ? `COALESCE(jsonb_agg(DISTINCT to_jsonb(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'path', c.path))) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories,`
      : `'[]'::jsonb AS categories,`;

    const aggFilters = include.filters
      ? `COALESCE(jsonb_agg(DISTINCT to_jsonb(jsonb_build_object('filter_type', pdf.filter_type, 'filter_name', pdf.filter_name))) FILTER (WHERE pdf.id IS NOT NULL), '[]') AS dynamic_filters,`
      : `'[]'::jsonb AS dynamic_filters,`;

    const aggMedia = include.media
      ? `COALESCE(jsonb_agg(DISTINCT to_jsonb(jsonb_build_object('id', m.id, 'url', m.url, 'type', m.type))) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,`
      : `'[]'::jsonb AS media,`;

    // Aggregate mapped categories
    const aggMappedCategories = `COALESCE(jsonb_agg(DISTINCT to_jsonb(jsonb_build_object('id', mc.id, 'name', mc.name, 'slug', mc.slug, 'path', mc.path))) FILTER (WHERE mc.id IS NOT NULL), '[]') AS mapped_categories,`;

    // We'll preserve order using array_position on the ids array (passed as param $1 for the aggregation query).
    // const mainSQL = `
    //       SELECT
    //         p.id, p.product_sku, p.name, p.title, p.short_description, p.description, p.brand_name, p.gender,
    //         p.product_img, p.product_img1, p.product_img2, p.product_img3, p.product_img4, p.product_img5,
    //         p.vendor_id, p.default_category_id, p.country_of_origin, p.is_active, p.created_at, p.updated_at,
    //         MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
    //         MAX(COALESCE(pv.sale_price, pv.price)) AS max_price,
    //         ${aggVariants}
    //         ${aggCategories}
    //         ${aggFilters}
    //         ${aggMedia}
    //         COUNT(DISTINCT pv.id) AS variant_count
    //       FROM products p
    //       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
    //       LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
    //       LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
    //       LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL
    //       LEFT JOIN media m ON (m.variant_id = pv.id AND m.deleted_at IS NULL)
    //       WHERE p.id = ANY($1)
    //       GROUP BY p.id
    //       ORDER BY array_position($1::uuid[], p.id)
    //     `;

    const mainSQL = `
  SELECT
    p.id, p.product_sku, p.name, p.title, p.short_description, p.description, p.brand_name, p.gender,
    p.product_img, p.product_img1, p.product_img2, p.product_img3, p.product_img4, p.product_img5,
    p.vendor_id, p.default_category_id, p.country_of_origin, p.is_active, p.created_at, p.updated_at,

    -- ✅ Correct pricing aggregates
    MIN(pv.sale_price) AS min_price,                  -- lowest sale price among variants
    MAX(pv.mrp) AS max_price,                         -- highest MRP among variants
    MIN(pv.vendorsaleprice) AS min_vendor_price,      -- lowest vendor sale price
    MAX(pv.vendormrp) AS max_vendor_price,            -- highest vendor MRP

    ${aggVariants}
    ${aggCategories}
    ${aggFilters}
    ${aggMedia}
    ${aggMappedCategories}

    COUNT(DISTINCT pv.id) AS variant_count

  FROM products p
  LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
  LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
  LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
  LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL
  LEFT JOIN media m ON (m.variant_id = pv.id AND m.deleted_at IS NULL)
  LEFT JOIN product_our_category_map pom ON pom.product_id = p.id
  LEFT JOIN categories mc ON mc.id = pom.our_category_id AND mc.deleted_at IS NULL
  WHERE p.id = ANY($1)
  GROUP BY p.id
  ORDER BY array_position($1::uuid[], p.id)
`;

    // pass ids as first param
    const mainParams = [ids];

    const { rows: productRows } = await client.query(mainSQL, mainParams);

    // map rows to expected structure
    const products = productRows.map((r) => ({
      id: r.id,
      product_sku: r.product_sku,
      name: r.name,
      title: r.title,
      short_description: r.short_description,
      description: r.description,
      brand_name: r.brand_name,
      gender: r.gender,
      product_img: r.product_img,
      product_img1: r.product_img1,
      product_img2: r.product_img2,
      product_img3: r.product_img3,
      product_img4: r.product_img4,
      product_img5: r.product_img5,
      vendor_id: r.vendor_id,
      default_category_id: r.default_category_id,
      country_of_origin: r.country_of_origin,
      is_active: r.is_active,
      created_at: r.created_at,
      updated_at: r.updated_at,
      min_price: r.min_price !== null ? Number(r.min_price) : null,
      max_price: r.max_price !== null ? Number(r.max_price) : null,
      min_vendor_price:
        r.min_vendor_price !== null ? Number(r.min_vendor_price) : null,
      max_vendor_price:
        r.max_vendor_price !== null ? Number(r.max_vendor_price) : null,
      variants: r.variants || [],
      categories: r.categories || [],
      dynamic_filters: r.dynamic_filters || [],
      media: r.media || [],
      mapped_categories: r.mapped_categories || [],
      variant_count: Number(r.variant_count || 0),
    }));

    return { total, products };
  },

  //Impleted Elastic Search
  /*  async getProductsFromOurCategory(options, client) {
     const {
       q,
       category_id,
       vendor_id,
       brands = [],
       colors = [],
       sizes = [],
       min_price,
       max_price,
       gender,
       country,
       sku,
       dynamic_filters = [],
       sort_by = "created_at",
       sort_order = "desc",
       limit = 20,
       offset = 0,
       include = {
         variants: true,
         categories: true,
         filters: true,
         media: true,
       },
       user_id = null, // ✅ for wishlist
     } = options;
 
     const whereClauses = ["p.deleted_at IS NULL"];
     const params = [];
     let idx = 1;
 
     let vendorCategoryIds = [];
     let ourCatIds = [];
     let ourCategoryProductsExist = false;
 
     // ✅ CATEGORY HANDLING (same as before)
     if (category_id) {
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
 
       ourCatIds = ourCatsRes.rows.map((r) => r.id);
 
       const vendorMapped = await client.query(
         `SELECT id FROM categories WHERE is_our_category = FALSE AND deleted_at IS NULL AND our_category = ANY($1)`,
         [ourCatIds]
       );
       const mappedVendorIds = vendorMapped.rows.map((r) => r.id);
 
       if (mappedVendorIds.length > 0) {
         const vendorDescRes = await client.query(
           `
           WITH RECURSIVE vendor_desc AS (
               SELECT id FROM categories WHERE id = ANY($1)
               UNION ALL
               SELECT c.id
               FROM categories c
               JOIN vendor_desc vd ON c.parent_id = vd.id
               WHERE c.deleted_at IS NULL
           )
           SELECT DISTINCT id FROM vendor_desc;
           `,
           [mappedVendorIds]
         );
         vendorCategoryIds = vendorDescRes.rows.map((r) => r.id);
       }
 
       const directMapCheck = await client.query(
         `SELECT COUNT(*)::int AS count FROM product_our_category_map WHERE our_category_id = ANY($1)`,
         [ourCatIds]
       );
       ourCategoryProductsExist = directMapCheck.rows[0].count > 0;
     }
 
     // ✅ Combine category filters
     if (vendorCategoryIds.length > 0 || ourCategoryProductsExist) {
       const combinedClauseParts = [];
 
       if (vendorCategoryIds.length > 0) {
         params.push(vendorCategoryIds);
         combinedClauseParts.push(`
           EXISTS (
               SELECT 1 FROM product_categories pc
               WHERE pc.product_id = p.id
                 AND pc.category_id = ANY($${idx}::uuid[])
                 AND pc.deleted_at IS NULL
           )
         `);
         idx++;
       }
 
       if (ourCategoryProductsExist) {
         params.push(ourCatIds);
         combinedClauseParts.push(`
           EXISTS (
               SELECT 1 FROM product_our_category_map pom
               WHERE pom.product_id = p.id
                 AND pom.our_category_id = ANY($${idx}::uuid[])
           )
         `);
         idx++;
       }
 
       whereClauses.push(`(${combinedClauseParts.join(" OR ")})`);
     } else if (category_id) {
       return { total: 0, products: [] };
     }
 
     // ✅ First: try ElasticSearch full-text search if q present
     let esSearch = null;
     if (q) {
       esSearch = await searchProductsInElastic({ q });
 
       // Agar ES ne successfully search kiya aur koi result nahi mila → directly return
       if (esSearch && esSearch.ids.length === 0) {
         return { total: 0, products: [] };
       }
     }
 
     // ✅ Text search condition (with ES or fallback SQL ILIKE)
     if (q) {
       if (esSearch && esSearch.ids && esSearch.ids.length > 0) {
         // ElasticSearch se aayi IDs ko use karo
         params.push(esSearch.ids);
         whereClauses.push(`p.id = ANY($${idx}::uuid[])`);
         idx++;
       } else {
         // ES fail ho gaya → purana ILIKE fallback
         const qPattern = `%${q}%`;
         params.push(qPattern, qPattern, qPattern, qPattern, qPattern, qPattern);
         whereClauses.push(`(
           p.name ILIKE $${idx} OR
           p.title ILIKE $${idx + 1} OR
           p.description ILIKE $${idx + 2} OR
           p.brand_name ILIKE $${idx + 3} OR
           EXISTS (
               SELECT 1 FROM product_variants pv_s
               WHERE pv_s.product_id = p.id AND pv_s.sku ILIKE $${idx + 4}
           ) OR
           EXISTS (
               SELECT 1 FROM product_categories pc_s
               JOIN categories c_s ON c_s.id = pc_s.category_id
               WHERE pc_s.product_id = p.id AND c_s.name ILIKE $${idx + 5}
           )
         )`);
         idx += 6;
       }
     }
 
     // ✅ Other filters (same as before)
 
     if (brands.length > 0) {
       params.push(brands);
       whereClauses.push(`p.brand_name = ANY($${idx}::text[])`);
       idx++;
     }
 
     if (vendor_id) {
       params.push(vendor_id);
       whereClauses.push(`p.vendor_id = $${idx}`);
       idx++;
     }
 
     if (sku) {
       params.push(sku);
       whereClauses.push(
         `EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.sku = $${idx})`
       );
       idx++;
     }
 
     if (gender) {
       params.push(gender);
       whereClauses.push(`p.gender = $${idx}`);
       idx++;
     }
 
     if (country) {
       params.push(country);
       whereClauses.push(`p.country_of_origin = $${idx}`);
       idx++;
     }
 
     if (min_price != null) {
       params.push(min_price);
       whereClauses.push(`
         EXISTS (
             SELECT 1 FROM product_variants pv
             WHERE pv.product_id = p.id AND COALESCE(pv.sale_price, pv.price) >= $${idx}
         )
       `);
       idx++;
     }
 
     if (max_price != null) {
       params.push(max_price);
       whereClauses.push(`
         EXISTS (
             SELECT 1 FROM product_variants pv
             WHERE pv.product_id = p.id AND COALESCE(pv.sale_price, pv.price) <= $${idx}
         )
       `);
       idx++;
     }
 
     if (colors.length > 0) {
       params.push(colors);
       whereClauses.push(`
         EXISTS (
             SELECT 1 FROM product_variants pv
             WHERE pv.product_id = p.id
               AND (pv.normalized_color = ANY($${idx}::text[]) OR pv.attributes->>'color' = ANY($${idx}::text[]))
         )
       `);
       idx++;
     }
 
     if (sizes.length > 0) {
       params.push(sizes);
       whereClauses.push(`
         EXISTS (
             SELECT 1 FROM product_variants pv
             WHERE pv.product_id = p.id
               AND (pv.variant_size = ANY($${idx}::text[]) OR pv.attributes->>'size' = ANY($${idx}::text[]))
         )
       `);
       idx++;
     }
 
     // ✅ Dynamic filters
     if (dynamic_filters.length > 0) {
       for (const df of dynamic_filters) {
         params.push(df.filter_type, df.filter_name);
         whereClauses.push(`
           EXISTS (
               SELECT 1 FROM product_dynamic_filters pdf
               WHERE pdf.product_id = p.id
                 AND pdf.filter_type = $${idx}
                 AND pdf.filter_name = $${idx + 1}
           )
         `);
         idx += 2;
       }
     }
 
     const whereSQL = whereClauses.length
       ? `WHERE ${whereClauses.join(" AND ")}`
       : "";
 
     // ✅ Count with all filters (including ES + DB filters)
     const countSQL = `SELECT COUNT(*)::int AS total FROM products p ${whereSQL}`;
     const countRes = await client.query(countSQL, params);
     const total = parseInt(countRes.rows[0].total, 10);
 
     if (total === 0) return { total: 0, products: [] };
 
     // ✅ Get IDs with sorting
     let idsSQL;
     if (sort_by === "price_low_to_high" || sort_by === "price_high_to_low") {
       const priceOrder = sort_by === "price_low_to_high" ? "ASC" : "DESC";
       idsSQL = `
         SELECT p.id,
                MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
                MAX(COALESCE(pv.sale_price, pv.price)) AS max_price
         FROM products p
         LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
         ${whereSQL}
         GROUP BY p.id
         ORDER BY ${priceOrder === "ASC" ? "min_price ASC" : "max_price DESC"}
         LIMIT $${idx} OFFSET $${idx + 1}
       `;
     } else {
       idsSQL = `
         SELECT p.id
         FROM products p
         ${whereSQL}
         ORDER BY p.${sort_by} ${sort_order}
         LIMIT $${idx} OFFSET $${idx + 1}
       `;
     }
 
     params.push(limit, offset);
     const idsRes = await client.query(idsSQL, params);
     const ids = idsRes.rows.map((r) => r.id);
 
     if (ids.length === 0) return { total: 0, products: [] };
 
     // ✅ Main query to fetch full products + relations
     const mainSQL = `
       SELECT
           p.*,
           jsonb_agg(DISTINCT pv.*) FILTER (WHERE pv.id IS NOT NULL) AS variants,
           jsonb_agg(DISTINCT m.*)  FILTER (WHERE m.id IS NOT NULL) AS media,
           jsonb_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'path', c.path))
               FILTER (WHERE c.id IS NOT NULL) AS categories,
           jsonb_agg(DISTINCT jsonb_build_object('filter_type', pdf.filter_type, 'filter_name', pdf.filter_name))
               FILTER (WHERE pdf.id IS NOT NULL) AS dynamic_filters
       FROM products p
       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
       LEFT JOIN media m ON m.variant_id = pv.id AND m.deleted_at IS NULL
       LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
       LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
       LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL
       WHERE p.id = ANY($1)
       AND p.is_active = TRUE
       GROUP BY p.id
       ORDER BY array_position($1::uuid[], p.id)
     `;
 
     const result = await client.query(mainSQL, [ids]);
     let products = result.rows;
 
     // ✅ Wishlist integration
     if (user_id) {
       const wishlistRes = await client.query(
         `SELECT product_id FROM wishlists WHERE user_id = $1 AND product_id = ANY($2)`,
         [user_id, ids]
       );
       const wishlistIds = wishlistRes.rows.map((r) => r.product_id);
       products = products.map((p) => ({
         ...p,
         wishlist: wishlistIds.includes(p.id),
       }));
     } else {
       products = products.map((p) => ({
         ...p,
         wishlist: false,
       }));
     }
 
     return { total, products };
   }, */

  //BEFORE IMPLEMENTING ELASTIC SEARCH
  async getProductsFromOurCategory(options, client) {
    const {
      q,
      category_id,
      vendor_id,
      brands = [],
      colors = [],
      sizes = [],
      min_price,
      max_price,
      gender,
      country,
      sku,
      dynamic_filters = [],
      sort_by = "created_at",
      sort_order = "desc",
      limit = 20,
      offset = 0,
      include = {
        variants: true,
        categories: true,
        filters: true,
        media: true,
      },
      user_id = null, // ✅ added for wishlist
    } = options;

    const whereClauses = ["p.deleted_at IS NULL"];
    const params = [];
    let idx = 1;

    let vendorCategoryIds = [];
    let ourCatIds = [];
    let ourCategoryProductsExist = false;

    // ✅ Category recursive lookup
    if (category_id) {
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

      ourCatIds = ourCatsRes.rows.map((r) => r.id);

      const vendorMapped = await client.query(
        `SELECT id FROM categories WHERE is_our_category = FALSE AND deleted_at IS NULL AND our_category = ANY($1)`,
        [ourCatIds]
      );
      const mappedVendorIds = vendorMapped.rows.map((r) => r.id);

      if (mappedVendorIds.length > 0) {
        const vendorDescRes = await client.query(
          `
          WITH RECURSIVE vendor_desc AS (
              SELECT id FROM categories WHERE id = ANY($1)
              UNION ALL
              SELECT c.id
              FROM categories c
              JOIN vendor_desc vd ON c.parent_id = vd.id
              WHERE c.deleted_at IS NULL
          )
          SELECT DISTINCT id FROM vendor_desc;
          `,
          [mappedVendorIds]
        );
        vendorCategoryIds = vendorDescRes.rows.map((r) => r.id);
      }

      const directMapCheck = await client.query(
        `SELECT COUNT(*)::int AS count FROM product_our_category_map WHERE our_category_id = ANY($1)`,
        [ourCatIds]
      );
      ourCategoryProductsExist = directMapCheck.rows[0].count > 0;
    }

    // ✅ Combine category filters
    if (vendorCategoryIds.length > 0 || ourCategoryProductsExist) {
      const combinedClauseParts = [];

      if (vendorCategoryIds.length > 0) {
        params.push(vendorCategoryIds);
        combinedClauseParts.push(`
          EXISTS (
              SELECT 1 FROM product_categories pc
              WHERE pc.product_id = p.id
                AND pc.category_id = ANY($${idx}::uuid[])
                AND pc.deleted_at IS NULL
          )
        `);
        idx++;
      }

      if (ourCategoryProductsExist) {
        params.push(ourCatIds);
        combinedClauseParts.push(`
          EXISTS (
              SELECT 1 FROM product_our_category_map pom
              WHERE pom.product_id = p.id
                AND pom.our_category_id = ANY($${idx}::uuid[])
          )
        `);
        idx++;
      }

      whereClauses.push(`(${combinedClauseParts.join(" OR ")})`);
    } else if (category_id) {
      return { total: 0, products: [] };
    }

    // ✅ Text search
    if (q) {
      const qPattern = `%${q}%`;
      params.push(qPattern, qPattern, qPattern, qPattern, qPattern, qPattern);
      whereClauses.push(`(
        p.name ILIKE $${idx} OR
        p.title ILIKE $${idx + 1} OR
        p.description ILIKE $${idx + 2} OR
        p.brand_name ILIKE $${idx + 3} OR
        EXISTS (
            SELECT 1 FROM product_variants pv_s
            WHERE pv_s.product_id = p.id AND pv_s.sku ILIKE $${idx + 4}
        ) OR
        EXISTS (
            SELECT 1 FROM product_categories pc_s
            JOIN categories c_s ON c_s.id = pc_s.category_id
            WHERE pc_s.product_id = p.id AND c_s.name ILIKE $${idx + 5}
        )
      )`);
      idx += 6;
    }

    // ✅ Other filters
    if (brands.length > 0) {
      params.push(brands);
      whereClauses.push(`p.brand_name = ANY($${idx}::text[])`);
      idx++;
    }

    if (vendor_id) {
      params.push(vendor_id);
      whereClauses.push(`p.vendor_id = $${idx}`);
      idx++;
    }

    if (sku) {
      params.push(sku);
      whereClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.sku = $${idx})`
      );
      idx++;
    }

    if (gender) {
      params.push(gender);
      whereClauses.push(`p.gender = $${idx}`);
      idx++;
    }

    if (country) {
      params.push(country);
      whereClauses.push(`p.country_of_origin = $${idx}`);
      idx++;
    }

    if (min_price != null) {
      params.push(min_price);
      whereClauses.push(`
        EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv.product_id = p.id AND COALESCE(pv.sale_price, pv.price) >= $${idx}
        )
      `);
      idx++;
    }

    if (max_price != null) {
      params.push(max_price);
      whereClauses.push(`
        EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv.product_id = p.id AND COALESCE(pv.sale_price, pv.price) <= $${idx}
        )
      `);
      idx++;
    }

    if (colors.length > 0) {
      params.push(colors);
      whereClauses.push(`
        EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv.product_id = p.id
              AND (pv.normalized_color = ANY($${idx}::text[]) OR pv.attributes->>'color' = ANY($${idx}::text[]))
        )
      `);
      idx++;
    }

    if (sizes.length > 0) {
      params.push(sizes);
      whereClauses.push(`
        EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv.product_id = p.id
              AND (pv.variant_size = ANY($${idx}::text[]) OR pv.attributes->>'size' = ANY($${idx}::text[]))
        )
      `);
      idx++;
    }

    // ✅ Dynamic filters
    if (dynamic_filters.length > 0) {
      for (const df of dynamic_filters) {
        params.push(df.filter_type, df.filter_name);
        whereClauses.push(`
          EXISTS (
              SELECT 1 FROM product_dynamic_filters pdf
              WHERE pdf.product_id = p.id
                AND pdf.filter_type = $${idx}
                AND pdf.filter_name = $${idx + 1}
          )
        `);
        idx += 2;
      }
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    const countSQL = `SELECT COUNT(*)::int AS total FROM products p ${whereSQL}`;
    const countRes = await client.query(countSQL, params);
    const total = parseInt(countRes.rows[0].total, 10);

    if (total === 0) return { total: 0, products: [] };

    let idsSQL;
    if (sort_by === "price_low_to_high" || sort_by === "price_high_to_low") {
      const priceOrder = sort_by === "price_low_to_high" ? "ASC" : "DESC";
      idsSQL = `
        SELECT p.id,
               MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
               MAX(COALESCE(pv.sale_price, pv.price)) AS max_price
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
        ${whereSQL}
        GROUP BY p.id
        ORDER BY ${priceOrder === "ASC" ? "min_price ASC" : "max_price DESC"}
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    } else {
      idsSQL = `
        SELECT p.id
        FROM products p
        ${whereSQL}
        ORDER BY p.${sort_by} ${sort_order}
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }

    params.push(limit, offset);
    const idsRes = await client.query(idsSQL, params);
    const ids = idsRes.rows.map((r) => r.id);

    if (ids.length === 0) return { total: 0, products: [] };

    const mainSQL = `
      SELECT
          p.*,
          jsonb_agg(DISTINCT pv.*) FILTER (WHERE pv.id IS NOT NULL) AS variants,
          jsonb_agg(DISTINCT m.*)  FILTER (WHERE m.id IS NOT NULL) AS media,
          jsonb_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'path', c.path))
              FILTER (WHERE c.id IS NOT NULL) AS categories,
          jsonb_agg(DISTINCT jsonb_build_object('filter_type', pdf.filter_type, 'filter_name', pdf.filter_name))
              FILTER (WHERE pdf.id IS NOT NULL) AS dynamic_filters
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      LEFT JOIN media m ON m.variant_id = pv.id AND m.deleted_at IS NULL
      LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
      LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
      LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL
      WHERE p.id = ANY($1)
      AND p.is_active = TRUE
      GROUP BY p.id
      ORDER BY array_position($1::uuid[], p.id)
    `;

    const result = await client.query(mainSQL, [ids]);
    let products = result.rows;

    // ✅ Wishlist integration (only if user_id exists)
    if (user_id) {
      const wishlistRes = await client.query(
        `SELECT product_id FROM wishlists WHERE user_id = $1 AND product_id = ANY($2)`,
        [user_id, ids]
      );
      const wishlistIds = wishlistRes.rows.map((r) => r.product_id);
      products = products.map((p) => ({
        ...p,
        wishlist: wishlistIds.includes(p.id),
      }));
    } else {
      products = products.map((p) => ({
        ...p,
        wishlist: false,
      }));
    }

    return { total, products };
  },

  async getSearchAutocomplete({ q, limit = 10 }, client) {
    const searchTerm = q.trim();
    if (!searchTerm) return [];

    const pattern = `${searchTerm}%`; // prefix search for autocomplete

    const sql = `
      WITH product_matches AS (
        SELECT DISTINCT
          p.id AS product_id,
          p.name AS value,
          'product'::text AS type,
          'name'::text AS field
        FROM products p
        WHERE p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND p.name ILIKE $1

        UNION

        SELECT DISTINCT
          p.id AS product_id,
          p.title AS value,
          'product'::text AS type,
          'title'::text AS field
        FROM products p
        WHERE p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND p.title ILIKE $1

        UNION

        SELECT DISTINCT
          p.id AS product_id,
          p.brand_name AS value,
          'product'::text AS type,
          'brand_name'::text AS field
        FROM products p
        WHERE p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND p.brand_name ILIKE $1
      ),
      category_matches AS (
        SELECT DISTINCT
          c.id AS category_id,
          c.name AS value,
          'category'::text AS type,
          'name'::text AS field
        FROM categories c
        WHERE c.deleted_at IS NULL
          AND c.name ILIKE $1
      ),
      sku_matches AS (
        SELECT DISTINCT
          p.id AS product_id,
          pv.sku AS value,
          'product'::text AS type,
          'sku'::text AS field
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND pv.sku ILIKE $1
      )
      SELECT value, type, field, product_id, category_id
      FROM (
        SELECT
          pm.value,
          pm.type,
          pm.field,
          pm.product_id,
          NULL::uuid AS category_id
        FROM product_matches pm

        UNION ALL

        SELECT
          cm.value,
          cm.type,
          cm.field,
          NULL::uuid AS product_id,
          cm.category_id
        FROM category_matches cm

        UNION ALL

        SELECT
          sm.value,
          sm.type,
          sm.field,
          sm.product_id,
          NULL::uuid AS category_id
        FROM sku_matches sm
      ) AS combined
      WHERE value IS NOT NULL
      ORDER BY
        CASE type
          WHEN 'category' THEN 1
          WHEN 'product' THEN 2
          ELSE 3
        END,
        value ASC
      LIMIT $2
    `;

    const params = [pattern, limit];
    const { rows } = await client.query(sql, params);

    // Shape suggestions cleanly for frontend
    return rows.map((row) => ({
      value: row.value,
      type: row.type, // 'product' | 'category'
      field: row.field, // 'name' | 'title' | 'brand_name' | 'sku'
      product_id: row.product_id || null,
      category_id: row.category_id || null,
    }));
  },



  async getProductById(productId, client) {
    // ✅ First query: fetch product + variants + categories + filters (NO media join)
    const sqlProduct = `
    SELECT
      p.id,
      p.vendor_id,
      p.productid,
      p.product_sku,
      p.name,
      p.title,
      p.short_description,
      p.description,
      p.brand_name,
      p.gender,
      p.default_category_id,
      p.attributes,
      p.product_meta,
      p.sizechart_text,
      p.sizechart_image,
      p.shipping_returns_payments,
      p.environmental_impact,
      p.product_img,
      p.product_img1,
      p.product_img2,
      p.product_img3,
      p.product_img4,
      p.product_img5,
      p.videos,
      p.delivery_time,
      p.cod_available,
      p.supplier,
      p.country_of_origin,
      p.is_active,
      p.created_at,
      p.updated_at,
      p.is_our_picks,
      p.is_newest,

     -- MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
     -- MAX(COALESCE(pv.sale_price, pv.price)) AS max_price,
     MIN(pv.sale_price) AS min_price,                  -- lowest sale price among variants
    MAX(pv.mrp) AS max_price,  

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', pv.id,
        'sku', pv.sku,
        'mrp', pv.mrp,
        'price', pv.price,
        'sale_price', pv.sale_price,
        'vendor_sale_price', pv.vendorsaleprice,
        'vendor_mrp', pv.vendormrp,
        'stock', pv.stock,
        'variant_color', pv.variant_color,
        'variant_size', pv.variant_size,
        'normalized_color', pv.normalized_color,
        'normalized_size', pv.normalized_size,
        'normalized_size_final', pv.normalized_size_final,
        'attributes', pv.attributes,
        'images', pv.images,
        'country_of_origin', pv.country_of_origin
      )) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'path', c.path
      )) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'filter_type', pdf.filter_type,
        'filter_name', pdf.filter_name
      )) FILTER (WHERE pdf.id IS NOT NULL), '[]') AS dynamic_filters

    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
    LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
    LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL

    WHERE p.deleted_at IS NULL AND p.is_active = TRUE AND p.id = $1

    GROUP BY
      p.id,p.vendor_id,p.productid,p.product_sku,p.name,p.title,p.short_description,p.description,
      p.brand_name,p.gender,p.default_category_id,p.attributes,p.product_meta,p.sizechart_text,
      p.sizechart_image,p.shipping_returns_payments,p.environmental_impact,p.product_img,
      p.product_img1,p.product_img2,p.product_img3,p.product_img4,p.product_img5,p.videos,
      p.delivery_time,p.cod_available,p.supplier,p.country_of_origin,p.is_active,p.created_at,
      p.updated_at,p.is_our_picks,p.is_newest
  `;

    const productResult = await client.query(sqlProduct, [productId]);
    if (!productResult.rows.length) return null;

    const p = productResult.rows[0];
    const variants = p.variants || [];

    // ✅ Extract variant IDs for media lookup
    const variantIds = variants.map((v) => v.id);

    // ✅ Second query: fetch media separately (FAST)
    const sqlMedia = `
      SELECT id, url, type
      FROM media
      WHERE deleted_at IS NULL
        AND  variant_id = ANY($1)
        
  `;

    const mediaResult = await client.query(sqlMedia, [variantIds]);

    return {
      id: p.id,
      vendor_id: p.vendor_id,
      productid: p.productid,
      product_sku: p.product_sku,
      name: p.name,
      title: p.title,
      short_description: p.short_description,
      description: p.description,
      brand_name: p.brand_name,
      gender: p.gender,
      default_category_id: p.default_category_id,
      country_of_origin: p.country_of_origin,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
      product_img: p.product_img,
      product_img1: p.product_img1,
      product_img2: p.product_img2,
      product_img3: p.product_img3,
      product_img4: p.product_img4,
      product_img5: p.product_img5,
      is_our_picks: p.is_our_picks,
      is_newest: p.is_newest,
      min_price: p.min_price ? Number(p.min_price) : null,
      max_price: p.max_price ? Number(p.max_price) : null,
      variants: variants,
      categories: p.categories,
      dynamic_filters: p.dynamic_filters,
      media: mediaResult.rows || [],
    };
  },
  //before adding mapped products logic
  /* async getProductByIdAdmin(productId, client) {
        // ✅ First query: fetch product + variants + categories + filters (NO media join)
        const sqlProduct = `
    SELECT
      p.id,
      p.vendor_id,
      p.productid,
      p.product_sku,
      p.name,
      p.title,
      p.short_description,
      p.description,
      p.brand_name,
      p.gender,
      p.default_category_id,
      p.attributes,
      p.product_meta,
      p.sizechart_text,
      p.sizechart_image,
      p.shipping_returns_payments,
      p.environmental_impact,
      p.product_img,
      p.product_img1,
      p.product_img2,
      p.product_img3,
      p.product_img4,
      p.product_img5,
      p.videos,
      p.delivery_time,
      p.cod_available,
      p.supplier,
      p.country_of_origin,
      p.is_active,
      p.created_at,
      p.updated_at,
      p.is_our_picks,
      p.is_newest,

     -- MIN(COALESCE(pv.sale_price, pv.price)) AS min_price,
     -- MAX(COALESCE(pv.sale_price, pv.price)) AS max_price,
     MIN(pv.sale_price) AS min_price,                  -- lowest sale price among variants
    MAX(pv.mrp) AS max_price,  

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', pv.id,
        'sku', pv.sku,
        'mrp', pv.mrp,
        'price', pv.price,
        'sale_price', pv.sale_price,
        'vendor_sale_price', pv.vendorsaleprice,
        'vendor_mrp', pv.vendormrp,
        'stock', pv.stock,
        'variant_color', pv.variant_color,
        'variant_size', pv.variant_size,
        'normalized_color', pv.normalized_color,
        'normalized_size', pv.normalized_size,
        'normalized_size_final', pv.normalized_size_final,
        'attributes', pv.attributes,
        'images', pv.images,
        'country_of_origin', pv.country_of_origin
      )) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'path', c.path
      )) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'filter_type', pdf.filter_type,
        'filter_name', pdf.filter_name
      )) FILTER (WHERE pdf.id IS NOT NULL), '[]') AS dynamic_filters

    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
    LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
    LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL

    WHERE p.deleted_at IS NULL AND p.id = $1

    GROUP BY
      p.id,p.vendor_id,p.productid,p.product_sku,p.name,p.title,p.short_description,p.description,
      p.brand_name,p.gender,p.default_category_id,p.attributes,p.product_meta,p.sizechart_text,
      p.sizechart_image,p.shipping_returns_payments,p.environmental_impact,p.product_img,
      p.product_img1,p.product_img2,p.product_img3,p.product_img4,p.product_img5,p.videos,
      p.delivery_time,p.cod_available,p.supplier,p.country_of_origin,p.is_active,p.created_at,
      p.updated_at,p.is_our_picks,p.is_newest
  `;

        const productResult = await client.query(sqlProduct, [productId]);
        if (!productResult.rows.length) return null;

        const p = productResult.rows[0];
        const variants = p.variants || [];

        // ✅ Extract variant IDs for media lookup
        const variantIds = variants.map((v) => v.id);

        // ✅ Second query: fetch media separately (FAST)
        const sqlMedia = `
      SELECT id, url, type
      FROM media
      WHERE deleted_at IS NULL
        AND  variant_id = ANY($1)
        
  `;

        const mediaResult = await client.query(sqlMedia, [variantIds]);

        return {
            id: p.id,
            vendor_id: p.vendor_id,
            productid: p.productid,
            product_sku: p.product_sku,
            name: p.name,
            title: p.title,
            short_description: p.short_description,
            description: p.description,
            brand_name: p.brand_name,
            gender: p.gender,
            default_category_id: p.default_category_id,
            country_of_origin: p.country_of_origin,
            is_active: p.is_active,
            created_at: p.created_at,
            updated_at: p.updated_at,
            product_img: p.product_img,
            product_img1: p.product_img1,
            product_img2: p.product_img2,
            product_img3: p.product_img3,
            product_img4: p.product_img4,
            product_img5: p.product_img5,
            is_our_picks: p.is_our_picks,
            is_newest: p.is_newest,
            min_price: p.min_price ? Number(p.min_price) : null,
            max_price: p.max_price ? Number(p.max_price) : null,
            variants: variants,
            categories: p.categories,
            dynamic_filters: p.dynamic_filters,
            media: mediaResult.rows || [],
        };
    }, */

  async getProductByIdAdmin(productId, client) {
    // ✅ Base Product Query (same as before)
    const sqlProduct = `
    SELECT
      p.id,
      p.vendor_id,
      p.productid,
      p.product_sku,
      p.name,
      p.title,
      p.short_description,
      p.description,
      p.brand_name,
      p.gender,
      p.default_category_id,
      p.attributes,
      p.product_meta,
      p.sizechart_text,
      p.sizechart_image,
      p.shipping_returns_payments,
      p.environmental_impact,
      p.product_img,
      p.product_img1,
      p.product_img2,
      p.product_img3,
      p.product_img4,
      p.product_img5,
      p.videos,
      p.delivery_time,
      p.cod_available,
      p.supplier,
      p.country_of_origin,
      p.is_active,
      p.created_at,
      p.updated_at,
      p.is_our_picks,
      p.is_newest,
      MIN(pv.sale_price) AS min_price,
      MAX(pv.mrp) AS max_price,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', pv.id,
        'sku', pv.sku,
        'mrp', pv.mrp,
        'price', pv.price,
        'sale_price', pv.sale_price,
        'vendor_sale_price', pv.vendorsaleprice,
        'vendor_mrp', pv.vendormrp,
        'stock', pv.stock,
        'variant_color', pv.variant_color,
        'variant_size', pv.variant_size,
        'normalized_color', pv.normalized_color,
        'normalized_size', pv.normalized_size,
        'normalized_size_final', pv.normalized_size_final,
        'attributes', pv.attributes,
        'images', pv.images,
        'country_of_origin', pv.country_of_origin
      )) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'path', c.path
      )) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories,

      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'filter_type', pdf.filter_type,
        'filter_name', pdf.filter_name
      )) FILTER (WHERE pdf.id IS NOT NULL), '[]') AS dynamic_filters

    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
    LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
    LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.id = $1
    GROUP BY
      p.id,p.vendor_id,p.productid,p.product_sku,p.name,p.title,p.short_description,p.description,
      p.brand_name,p.gender,p.default_category_id,p.attributes,p.product_meta,p.sizechart_text,
      p.sizechart_image,p.shipping_returns_payments,p.environmental_impact,p.product_img,
      p.product_img1,p.product_img2,p.product_img3,p.product_img4,p.product_img5,p.videos,
      p.delivery_time,p.cod_available,p.supplier,p.country_of_origin,p.is_active,p.created_at,
      p.updated_at,p.is_our_picks,p.is_newest
  `;

    const productResult = await client.query(sqlProduct, [productId]);
    if (!productResult.rows.length) return null;

    const p = productResult.rows[0];
    const variants = p.variants || [];
    const variantIds = variants.map((v) => v.id);

    // ✅ Media query
    const sqlMedia = `
    SELECT id, url, type
    FROM media
    WHERE deleted_at IS NULL
      AND variant_id = ANY($1)
  `;
    const mediaResult = await client.query(sqlMedia, [variantIds]);

    // ✅ Fetch all mapped categories
    const sqlMappedCategories = `
    SELECT c.id, c.name, c.slug, c.path, c.parent_id
    FROM product_our_category_map pom
    JOIN categories c ON c.id = pom.our_category_id
    WHERE pom.product_id = $1
      AND c.deleted_at IS NULL
  `;
    const mappedRes = await client.query(sqlMappedCategories, [productId]);

    let mappedCategories = [];

    if (mappedRes.rows.length > 0) {
      for (const cat of mappedRes.rows) {
        // ✅ Recursive query to get full parent chain for each category
        const sqlParents = `
        WITH RECURSIVE parent_chain AS (
          SELECT id, name, slug, parent_id
          FROM categories
          WHERE id = $1
          UNION ALL
          SELECT c.id, c.name, c.slug, c.parent_id
          FROM categories c
          INNER JOIN parent_chain pc ON pc.parent_id = c.id
        )
        SELECT id, name, slug FROM parent_chain WHERE id != $1;
      `;
        const parentRes = await client.query(sqlParents, [cat.id]);

        mappedCategories.push({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          path: cat.path,
          parents: parentRes.rows.reverse(), // so parent → child order
        });
      }
    }

    // ✅ Final response
    return {
      id: p.id,
      vendor_id: p.vendor_id,
      productid: p.productid,
      product_sku: p.product_sku,
      name: p.name,
      title: p.title,
      short_description: p.short_description,
      description: p.description,
      brand_name: p.brand_name,
      gender: p.gender,
      default_category_id: p.default_category_id,
      country_of_origin: p.country_of_origin,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
      product_img: p.product_img,
      product_img1: p.product_img1,
      product_img2: p.product_img2,
      product_img3: p.product_img3,
      product_img4: p.product_img4,
      product_img5: p.product_img5,
      is_our_picks: p.is_our_picks,
      is_newest: p.is_newest,
      min_price: p.min_price ? Number(p.min_price) : null,
      max_price: p.max_price ? Number(p.max_price) : null,
      variants,
      categories: p.categories,
      dynamic_filters: p.dynamic_filters,
      media: mediaResult.rows || [],
      mapped_categories: mappedCategories, // ✅ all mapped categories with parent hierarchy
    };
  },
  async updateProductPrice(productId, type, varient_id, price, client) {
    const validTypes = {
      mrp: "mrp",
      sale_price: "sale_price",
    };

    if (!validTypes[type]) {
      throw new AppError("Invalid type. Use 'mrp' or 'sale_price'", 400);
    }

    const column = type === "mrp" ? "mrp" : "sale_price";

    const query = `
        UPDATE product_variants 
        SET ${column} = $1, updated_at = NOW()
        WHERE id = $2 
          AND product_id = $3 
          AND deleted_at IS NULL 
        RETURNING *
    `;

    const { rows } = await client.query(query, [price, varient_id, productId]);

    if (rows.length === 0) {
      throw new AppError("Variant not found or already deleted", 404);
    }

    return rows[0];
  },

  async updateProductPriceByVendorId(vendorId, percentage, client) {
    try {
      console.log(`Starting FAST price update for vendor_id: ${vendorId}`);

      // Step 1: Get all product IDs
      const productRes = await client.query(
        `SELECT id FROM products WHERE vendor_id = $1 AND deleted_at IS NULL`,
        [vendorId]
      );

      if (productRes.rows.length === 0) {
        return { updated: 0, message: "No products found" };
      }

      const productIds = productRes.rows.map((r) => r.id);

      // Step 2: SINGLE QUERY → Update all variants using their own vendor_sale_price
      const result = await client.query(
        `
      UPDATE product_variants
      SET
        mrp = ROUND(
          mrp * (1 + COALESCE(vendorsaleprice, 0) / 100),
          2
        ),
        sale_price = ROUND(
          sale_price * (1 + COALESCE(vendorsaleprice, 0) / 100),
          2
        ),
        updated_at = NOW()
      WHERE
        product_id = ANY($1)
        AND deleted_at IS NULL
        AND vendorsaleprice IS NOT NULL
      RETURNING
        id,
        product_id,
        vendorsaleprice,
        mrp AS new_mrp,
        sale_price AS new_sale_price
      `,
        [productIds]
      );

      console.log(`Updated ${result.rowCount} variants in ONE query`);

      return {
        updated: result.rowCount,
        productIds,
        updatedVariants: result.rows.map((r) => ({
          variant_id: r.id,
          product_id: r.product_id,
          percent_applied: parseFloat(r.vendor_sale_price),
          new_mrp: parseFloat(r.new_mrp),
          new_sale_price: parseFloat(r.new_sale_price),
        })),
        message: `Updated ${result.rowCount} variants instantly`,
      };
    } catch (error) {
      console.error("Error in FAST update:", error);
      throw error;
    }
  },

  async getAllBrands(search, client) {
    if (search && search.length > 0) {
      const { rows } = await client.query(
        `SELECT DISTINCT brand_name FROM products WHERE deleted_at IS NULL AND brand_name ILIKE $1`,
        [`%${search}%`]
      );
      return rows;
    }
    const { rows } = await client.query(
      `SELECT DISTINCT brand_name FROM products WHERE deleted_at IS NULL`
    );
    return rows;
  },
};

module.exports = ProductService;
