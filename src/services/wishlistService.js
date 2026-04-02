const AppError = require("../errorHandling/AppError");

const WishlistService = {
  async addToWishlist({ user_id, product_id }, client) {
    const productQuery = `
    SELECT 
      id,
      name,
      brand_name,
      product_img
    FROM products
    WHERE id = $1 AND is_active = true
    LIMIT 1;
  `;

    const productRes = await client.query(productQuery, [product_id]);
    if (productRes.rowCount === 0) {
      throw new AppError("Product not found", 404);
    }

    const p = productRes.rows[0];

    // 2️⃣ Fetch ALL variants of the product
    const variantQuery = `
    SELECT
      price,
      mrp,
      stock,
      images,
      image_urls,
      is_active
    FROM product_variants
    WHERE product_id = $1 AND is_active = true;
  `;

    const variantRes = await client.query(variantQuery, [product_id]);
    const variants = variantRes.rows;

    if (variants.length === 0) {
      throw new AppError("No active variants found", 400);
    }

    // 3️⃣ Build snapshot data

    // Choose main image (variant image → fallback product image)
    const snap_image =
      variants?.[0]?.image_urls?.[0] ||
      variants?.[0]?.images?.[0] ||
      p.product_img ||
      null;

    // Min/Max price (using price, not sale_price)
    let prices = variants.map((v) => Number(v.price)).filter(p => p > 0);
    const snap_min_price = prices.length > 0 ? Math.min(...prices) : 0;
    const snap_max_price = prices.length > 0 ? Math.max(...prices) : 0;

    // In Stock → check any variant has stock > 0
    const snap_in_stock = variants.some((v) => Number(v.stock) > 0);

    // 4️⃣ Insert / Update wishlist row
    const insertQuery = `
    INSERT INTO wishlists (
      user_id, product_id,
      snap_name, snap_brand_name,
      snap_image, snap_min_price, snap_max_price, snap_in_stock
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET
      snap_name = EXCLUDED.snap_name,
      snap_brand_name = EXCLUDED.snap_brand_name,
      snap_image = EXCLUDED.snap_image,
      snap_min_price = EXCLUDED.snap_min_price,
      snap_max_price = EXCLUDED.snap_max_price,
      snap_in_stock = EXCLUDED.snap_in_stock,
      updated_at = NOW()
    RETURNING *;
  `;

    const result = await client.query(insertQuery, [
      user_id,
      product_id,
      p.name,
      p.brand_name,
      snap_image,
      snap_min_price,
      snap_max_price,
      snap_in_stock,
    ]);

    return result.rows[0];
  },

  async getWishlist(user_id, client) {
    const query = `
    SELECT
      id,
      product_id,
      snap_name,
      snap_brand_name,
      snap_image,
      snap_min_price,
      snap_max_price,
      snap_in_stock,
      created_at
    FROM wishlists
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;

    const result = await client.query(query, [user_id]);
    return result.rows;
  },

  async removeFromWishlist(user_id, product_id, client) {
    const query = `
    DELETE FROM wishlists
    WHERE user_id = $1 AND product_id = $2
    RETURNING *;
  `;

    const result = await client.query(query, [user_id, product_id]);

    if (result.rowCount === 0) {
      throw new Error("Product not found in wishlist");
    }

    return result.rows[0];
  },
};

module.exports = {
  WishlistService,
};
