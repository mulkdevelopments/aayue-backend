module.exports.DynamicFilterQueries = {
    insertDynamicFilter: `
        INSERT INTO product_dynamic_filters (product_id, filter_type, filter_name)
        VALUES ($1, $2, $3)
        RETURNING *;
    `,

    findFiltersByProduct: `
        SELECT * FROM product_dynamic_filters WHERE product_id = $1 AND deleted_at IS NULL;
    `,

    deleteDynamicFilter: `
        UPDATE product_dynamic_filters
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *;
    `
};
