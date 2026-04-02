// scripts/reindexProducts.js

require("dotenv").config();
const { esClient } = require("../config/elasticsearch");
const dbPool = require("../db/dbConnection");

const INDEX_NAME = process.env.ES_PRODUCTS_INDEX || "products";

async function fetchProductsBatch(offset, limit) {
    const client = await dbPool.connect();
    try {
        const sql = `
      SELECT
        p.*,
        jsonb_agg(DISTINCT pv.*) FILTER (WHERE pv.id IS NOT NULL) AS variants,
        jsonb_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'path', c.path))
            FILTER (WHERE c.id IS NOT NULL) AS categories,
        jsonb_agg(DISTINCT jsonb_build_object('filter_type', pdf.filter_type, 'filter_name', pdf.filter_name))
            FILTER (WHERE pdf.id IS NOT NULL) AS dynamic_filters
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      LEFT JOIN product_categories pc ON pc.product_id = p.id AND pc.deleted_at IS NULL
      LEFT JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL
      LEFT JOIN product_dynamic_filters pdf ON pdf.product_id = p.id AND pdf.deleted_at IS NOT NULL IS FALSE
      WHERE p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `;

        const result = await client.query(sql, [limit, offset]);
        return result.rows;
    } finally {
        client.release();
    }
}

// Safely normalize for ES document
function buildEsDocFromProductRow(row) {
    const {
        id,
        name,
        title,
        description,
        brand_name,
        gender,
        country_of_origin,
        created_at,
        variants,
        categories,
        dynamic_filters,
    } = row;

    return {
        id,
        name: name || "",
        title: title || "",
        description: description || "",
        brand_name: brand_name || "",
        gender: gender || null,
        country_of_origin: country_of_origin || null,
        created_at: created_at || null,
        variants: Array.isArray(variants)
            ? variants.map((v) => ({
                id: v.id,
                sku: v.sku,
                price: v.price,
                sale_price: v.sale_price,
                normalized_color: v.normalized_color,
                variant_size: v.variant_size,
            }))
            : [],
        categories: Array.isArray(categories) ? categories : [],
        dynamic_filters: Array.isArray(dynamic_filters) ? dynamic_filters : [],
    };
}

async function bulkIndexProducts(products) {
    if (!products.length) return;

    const body = [];

    for (const p of products) {
        const doc = buildEsDocFromProductRow(p);
        body.push({
            index: {
                _index: INDEX_NAME,
                _id: doc.id,
            },
        });
        body.push(doc);
    }

    const { body: bulkResp } = await esClient.bulk({ refresh: true, body }).catch(
        (err) => {
            console.error("Bulk index error:", err);
            throw err;
        }
    );

    if (bulkResp && bulkResp.errors) {
        console.error("Bulk indexing had some errors:", bulkResp);
    } else {
        console.log(`Indexed batch of ${products.length} products`);
    }
}

async function reindexAllProducts() {
    let offset = 0;
    const limit = 500;

    while (true) {
        console.log(`Fetching batch offset=${offset}, limit=${limit}`);
        const products = await fetchProductsBatch(offset, limit);
        if (!products.length) {
            console.log("No more products, done.");
            break;
        }

        await bulkIndexProducts(products);

        offset += products.length;
    }
}

reindexAllProducts()
    .then(() => {
        console.log("Reindex completed");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Reindex error:", err);
        process.exit(1);
    });
