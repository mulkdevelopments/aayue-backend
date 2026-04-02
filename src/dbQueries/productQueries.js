module.exports.ProductQueries = {
    // Products
    insertProduct: `
    INSERT INTO products (vendor_id, product_sku, name, short_description, description, brand, gender, default_category_id, attributes, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;
  `,
    updateProduct: `
    UPDATE products
    SET vendor_id=$1, product_sku=$2, name=$3, short_description=$4, description=$5, brand=$6, gender=$7, default_category_id=$8, attributes=$9, metadata=$10, updated_at=now()
    WHERE id=$11 RETURNING *;
  `,
    getProductById: `SELECT * FROM products WHERE id=$1 AND deleted_at IS NULL;`,
    getAllProducts: `SELECT * FROM products WHERE deleted_at IS NULL;`,
    softDeleteProduct: `UPDATE products SET deleted_at=now() WHERE id=$1 RETURNING *;`,

    // Product variants
    insertProductVariant: `
    INSERT INTO product_variants (product_id, sku, barcode, vendor_product_id, price, mrp, sale_price, stock, weight, length, width, height, attributes, images)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *;
  `,
    updateProductVariant: `
    UPDATE product_variants
    SET sku=$1, barcode=$2, vendor_product_id=$3, price=$4, mrp=$5, sale_price=$6, stock=$7, weight=$8, length=$9, width=$10, height=$11, attributes=$12, images=$13, updated_at=now()
    WHERE id=$14 RETURNING *;
  `,
    getVariantById: `SELECT * FROM product_variants WHERE id=$1 AND deleted_at IS NULL;`,
    getVariantsByProductId: `SELECT * FROM product_variants WHERE product_id=$1 AND deleted_at IS NULL;`,
    softDeleteVariant: `UPDATE product_variants SET deleted_at=now() WHERE id=$1 RETURNING *;`,

    // Product categories
    assignCategoryToProduct: `
    INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2) RETURNING *;
  `,
    removeCategoryFromProduct: `
    DELETE FROM product_categories WHERE product_id=$1 AND category_id=$2 RETURNING *;
  `,
    getCategoriesByProduct: `
    SELECT c.* FROM categories c
    JOIN product_categories pc ON c.id = pc.category_id
    WHERE pc.product_id=$1 AND c.deleted_at IS NULL;
  `
};
