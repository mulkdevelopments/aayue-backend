// scripts/createProductsIndex.js

require("dotenv").config();
const { esClient } = require("../config/elasticsearch");

const INDEX_NAME = process.env.ES_PRODUCTS_INDEX || "products";

async function createProductsIndex() {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });

    if (exists) {
        console.log(`Index "${INDEX_NAME}" already exists`);
        return;
    }

    const body = {
        settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
            analysis: {
                analyzer: {
                    custom_text_analyzer: {
                        type: "custom",
                        tokenizer: "standard",
                        filter: ["lowercase", "asciifolding"],
                    },
                },
            },
        },
        mappings: {
            properties: {
                id: { type: "keyword" }, // product id (uuid)
                name: { type: "text", analyzer: "custom_text_analyzer" },
                title: { type: "text", analyzer: "custom_text_analyzer" },
                description: { type: "text", analyzer: "custom_text_analyzer" },
                brand_name: { type: "text", analyzer: "custom_text_analyzer" },
                gender: { type: "keyword" },
                country_of_origin: { type: "keyword" },

                // categories
                categories: {
                    type: "nested",
                    properties: {
                        id: { type: "keyword" },
                        name: { type: "text", analyzer: "custom_text_analyzer" },
                        slug: { type: "keyword" },
                        path: { type: "text", analyzer: "custom_text_analyzer" },
                    },
                },

                // variants
                variants: {
                    type: "nested",
                    properties: {
                        id: { type: "keyword" },
                        sku: { type: "text", analyzer: "custom_text_analyzer" },
                        price: { type: "float" },
                        sale_price: { type: "float" },
                        normalized_color: { type: "keyword" },
                        variant_size: { type: "keyword" },
                    },
                },

                // dynamic filters
                dynamic_filters: {
                    type: "nested",
                    properties: {
                        filter_type: { type: "keyword" },
                        filter_name: { type: "keyword" },
                    },
                },

                // created_at for recency sort (optional)
                created_at: { type: "date" },
            },
        },
    };

    await esClient.indices.create({
        index: INDEX_NAME,
        body,
    });

    console.log(`Index "${INDEX_NAME}" created successfully.`);
}

createProductsIndex()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Error creating index:", err);
        process.exit(1);
    });
