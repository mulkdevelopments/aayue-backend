module.exports.ProductCategoryQueries = {
    insertProductCategory: `
        INSERT INTO product_categories (product_id, category_id)
        VALUES ($1, $2)
        RETURNING *;
    `,

    findProductCategories: `
        SELECT * FROM product_categories WHERE product_id = $1 AND deleted_at IS NULL;
    `,

    deleteProductCategory: `
        UPDATE product_categories
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *;
    `
};
