const dbPool = require('../db/dbConnection');
const AdminProductQueries = require('../dbQueries/productQueries');

module.exports.AdminProductService = {
    createCategory: async ({ name, slug, parent_id = null, metadata = {} }) => {
        const { rows } = await dbPool.query(AdminProductQueries.createCategory, [name, slug, parent_id, metadata]);
        return rows[0];
    },

    updateCategory: async ({ id, name, slug, metadata = {} }) => {
        const { rows } = await dbPool.query(AdminProductQueries.updateCategory, [name, slug, metadata, id]);
        return rows[0];
    },

    deleteCategory: async (id) => {
        const { rows } = await dbPool.query(AdminProductQueries.deleteCategory, [id]);
        return rows[0];
    },

    createProduct: async ({ vendor_id, product_sku, name, short_description, description, brand, gender, default_category_id, attributes = {}, metadata = {} }) => {
        const { rows } = await dbPool.query(AdminProductQueries.createProduct, [vendor_id, product_sku, name, short_description, description, brand, gender, default_category_id, attributes, metadata]);
        return rows[0];
    },

    updateProduct: async ({ id, name, short_description, description, brand, gender, default_category_id, attributes = {}, metadata = {} }) => {
        const { rows } = await dbPool.query(AdminProductQueries.updateProduct, [name, short_description, description, brand, gender, default_category_id, attributes, metadata, id]);
        return rows[0];
    },

    deleteProduct: async (id) => {
        const { rows } = await dbPool.query(AdminProductQueries.deleteProduct, [id]);
        return rows[0];
    },

    assignProductCategory: async ({ product_id, category_id }) => {
        const { rows } = await dbPool.query(AdminProductQueries.assignProductCategory, [product_id, category_id]);
        return rows[0];
    },
};
