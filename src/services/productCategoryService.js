const dbPool = require("../db/dbConnection");
const { ProductCategoryQueries: queries } = require("../dbQueries/productCategoryQueries");

module.exports.ProductCategoryService = {
    addProductCategory: async ({ product_id, category_id }) => {
        const { rows } = await dbPool.query(queries.insertProductCategory, [product_id, category_id]);
        return rows[0];
    },

    getProductCategories: async (product_id) => {
        const { rows } = await dbPool.query(queries.findProductCategories, [product_id]);
        return rows;
    },

    deleteProductCategory: async (id) => {
        const { rows } = await dbPool.query(queries.deleteProductCategory, [id]);
        return rows[0];
    },
};
