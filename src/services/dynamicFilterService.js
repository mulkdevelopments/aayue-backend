const dbPool = require("../db/dbConnection");
const { DynamicFilterQueries: queries } = require("../dbQueries/dynamicFilterQueries");

module.exports.DynamicFilterService = {
    addFilter: async ({ product_id, filter_type, filter_name }) => {
        const { rows } = await dbPool.query(queries.insertDynamicFilter, [product_id, filter_type, filter_name]);
        return rows[0];
    },

    getFiltersByProduct: async (product_id) => {
        const { rows } = await dbPool.query(queries.findFiltersByProduct, [product_id]);
        return rows;
    },

    deleteFilter: async (id) => {
        const { rows } = await dbPool.query(queries.deleteDynamicFilter, [id]);
        return rows[0];
    },
};
