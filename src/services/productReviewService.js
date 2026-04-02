const AppError = require("../errorHandling/AppError");

const ProductReviewService = {
  async addReview(
    { userId, productId, rating, reviewText = null, images = [] },
    client
  ) {
    try {
      await client.query("BEGIN");

      const purchasedQ = `
      SELECT 1
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE o.user_id = $1
        AND o.payment_status = 'paid'
        AND o.deleted_at IS NULL
        AND pv.product_id = $2
      LIMIT 1
    `;
      const purchasedRes = await client.query(purchasedQ, [userId, productId]);
      if (purchasedRes.rowCount === 0) {
        throw {
          status: 403,
          message: "Product not purchased by user or payment not completed",
        };
      }

      const existsQ = `SELECT id FROM product_reviews WHERE user_id = $1 AND product_id = $2 LIMIT 1`;
      const existsRes = await client.query(existsQ, [userId, productId]);
      if (existsRes.rowCount > 0) {
        throw {
          status: 409,
          message:
            "User has already reviewed this product. Use update endpoint.",
        };
      }

      const insertQ = `
      INSERT INTO product_reviews (product_id, user_id, rating, review_text, images)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, product_id, user_id, rating, review_text, images, created_at, updated_at
    `;
      const insertRes = await client.query(insertQ, [
        productId,
        userId,
        rating,
        reviewText,
        images.length ? images : null,
      ]);

      await client.query("COMMIT");
      return insertRes.rows[0];
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});

      if (err && err.code === "23505") {
        throw {
          status: 409,
          message: "User has already reviewed this product",
        };
      }
      throw err;
    } finally {
      client.release();
    }
  },

  async getProductReviews(
    {
      productId,
      page = 1,
      limit = 10,
      rating = null,
      with_images = null,
      verified = null,
      sort = "newest",
    },
    client
  ) {
    try {
      // sanitize / normalize
      page = Math.max(parseInt(page, 10) || 1, 1);
      limit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const filters = ["pr.product_id = $1"];
      const values = [productId];
      let idx = values.length + 1;

      if (rating !== null && rating !== undefined && rating !== "") {
        filters.push(`pr.rating = $${idx++}`);
        values.push(parseInt(rating, 10));
      }

      if (with_images === "true" || with_images === true) {
        filters.push(`COALESCE(array_length(pr.images,1),0) > 0`);
      }

      if (verified === "true" || verified === true) {
        filters.push(`
        EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN product_variants v ON v.id = oi.variant_id
          WHERE o.user_id = pr.user_id
            AND v.product_id = pr.product_id
            AND o.payment_status = 'paid'
            AND o.deleted_at IS NULL
        )
      `);
      }

      // Sorting
      let orderClause = "pr.created_at DESC";
      if (sort === "highest")
        orderClause = "pr.rating DESC, pr.created_at DESC";
      else if (sort === "lowest")
        orderClause = "pr.rating ASC, pr.created_at DESC";
      else if (sort === "most_helpful") {
        orderClause = "COALESCE(help.helpful_count,0) DESC, pr.created_at DESC";
      }

      // Main reviews query with helpful_count and verified flag
      const reviewsQ = `
      SELECT pr.id,
             pr.user_id,
             u.full_name as user_name,
             pr.rating,
             pr.review_text,
             pr.images,
             pr.created_at,
             pr.updated_at,
             (CASE WHEN v.verified_count > 0 THEN true ELSE false END) as verified_buyer
      FROM product_reviews pr
      LEFT JOIN users u ON u.id = pr.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as verified_count
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN product_variants vt ON vt.id = oi.variant_id
        WHERE o.user_id = pr.user_id
          AND vt.product_id = pr.product_id
          AND o.payment_status = 'paid'
          AND o.deleted_at IS NULL
        LIMIT 1
      ) v ON true
      WHERE ${filters.join(" AND ")}
      ORDER BY ${orderClause}
      LIMIT $${idx++} OFFSET $${idx++}
    `;
      values.push(limit, offset);

      // --- Run queries inside a transaction (single snapshot) ---
      await client.query("BEGIN");

      // 1) reviews
      const reviewsRes = await client.query(reviewsQ, values);

      // Prepare params for count & aggregation (exclude limit & offset)
      const countParams = values.slice(0, values.length - 2);

      // 2) count (single SELECT)
      const countQ = `SELECT COUNT(*)::int as total FROM product_reviews pr WHERE ${filters.join(
        " AND "
      )}`;
      const countRes = await client.query(countQ, countParams);

      // 3) aggregation (single SELECT)
      const aggQ = `
      SELECT
        ROUND(AVG(pr.rating)::numeric,2) as avg_rating,
        COUNT(*) FILTER (WHERE pr.rating = 5) as r5,
        COUNT(*) FILTER (WHERE pr.rating = 4) as r4,
        COUNT(*) FILTER (WHERE pr.rating = 3) as r3,
        COUNT(*) FILTER (WHERE pr.rating = 2) as r2,
        COUNT(*) FILTER (WHERE pr.rating = 1) as r1
      FROM product_reviews pr
      WHERE ${filters.join(" AND ")}
    `;
      const aggRes = await client.query(aggQ, countParams);

      await client.query("COMMIT");

      const total = countRes.rows[0].total;
      const aggRow = aggRes.rows[0];

      const rating_counts = {
        5: parseInt(aggRow.r5 || 0, 10),
        4: parseInt(aggRow.r4 || 0, 10),
        3: parseInt(aggRow.r3 || 0, 10),
        2: parseInt(aggRow.r2 || 0, 10),
        1: parseInt(aggRow.r1 || 0, 10),
      };

      const avg_rating = aggRow.avg_rating
        ? parseFloat(aggRow.avg_rating)
        : null;

      return {
        reviews: reviewsRes.rows,
        meta: {
          total,
          page,
          limit,
          avg_rating,
          rating_counts,
        },
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  },

  //   async  updateReview({ reviewId, userId, rating, reviewText = null, images = [] }) {
  //   const client = await dbPool.connect();
  //   try {
  //     const q = `
  //       UPDATE product_reviews
  //       SET rating = $1,
  //           review_text = $2,
  //           images = $3,
  //           updated_at = NOW()
  //       WHERE id = $4 AND user_id = $5
  //       RETURNING id, product_id, user_id, rating, review_text, images, created_at, updated_at
  //     `;
  //     const res = await client.query(q, [rating, reviewText, images.length ? images : null, reviewId, userId]);
  //     if (res.rowCount === 0) throw { status: 404, message: 'Review not found or not owned by user' };
  //     return res.rows[0];
  //   } finally {
  //     client.release();
  //   }
  // }

  // async deleteReview({ reviewId, userId }) {
  //   const client = await dbPool.connect();
  //   try {
  //     const q = `DELETE FROM product_reviews WHERE id = $1 AND user_id = $2 RETURNING id`;
  //     const res = await client.query(q, [reviewId, userId]);
  //     if (res.rowCount === 0) throw { status: 404, message: 'Review not found or not owned by user' };
  //     return { id: res.rows[0].id };
  //   } finally {
  //     client.release();
  //   }
  // }
};

module.exports = { ProductReviewService };
