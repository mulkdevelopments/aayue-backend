// src/config/elasticsearch.js

const { Client } = require("@elastic/elasticsearch");

const esClient = new Client({
    node: process.env.ES_NODE_URL || "http://localhost:9200",
    // Agar auth hai to yaha add kar:
    // auth: { username: process.env.ES_USER, password: process.env.ES_PASS }
});

module.exports = {
    esClient,
};
