// services/brandSpotlightService.js
const { randomUUID } = require("crypto");
const BrandSpotlightService = {
    async createSpotlight(payload, client) {
        const id = randomUUID();
        const sql = `
      INSERT INTO brand_spotlights
        (id, brand_name, vendor_id, meta, rank, active, start_at, end_at, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9, now(), now())
      RETURNING *
    `;
        const vals = [
            id,
            payload.brand_name,
            payload.vendor_id || null,
            payload.meta ? JSON.stringify(payload.meta) : JSON.stringify({}),
            payload.rank || null,
            payload.active !== undefined ? payload.active : true,
            payload.start_at || null,
            payload.end_at || null,
            payload.created_by || null
        ];
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    async updateSpotlight(id, updates, client) {
        const allowed = ['meta', 'rank', 'active', 'start_at', 'end_at'];
        const parts = [];
        const vals = [];
        let idx = 1;
        for (const key of allowed) {
            if (updates[key] !== undefined) {
                parts.push(`${key} = $${idx}`);
                vals.push(key === 'meta' ? JSON.stringify(updates[key]) : updates[key]);
                idx++;
            }
        }
        if (parts.length === 0) return null;
        parts.push('updated_at = now()');
        const sql = `UPDATE brand_spotlights SET ${parts.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
        vals.push(id);
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    async deleteSpotlight(id, client) {
        const sql = `UPDATE brand_spotlights SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
        const { rows } = await client.query(sql, [id]);
        return rows[0];
    },

    async listSpotlights({ limit = 50, offset = 0, include_inactive = false }, client) {
        const now = new Date();
        const where = [`bs.deleted_at IS NULL`];
        const params = [];
        let idx = 1;
        if (!include_inactive) {
            where.push(`bs.active = true`);
            where.push(`(bs.start_at IS NULL OR bs.start_at <= $${idx})`); params.push(now); idx++;
            where.push(`(bs.end_at IS NULL OR bs.end_at >= $${idx})`); params.push(now); idx++;
        }
        const whereSQL = `WHERE ${where.join(' AND ')}`;
        const sql = `
      SELECT bs.* FROM brand_spotlights bs
      ${whereSQL}
      ORDER BY bs.rank ASC NULLS LAST, bs.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
        params.push(limit, offset);
        const { rows } = await client.query(sql, params);
        return rows;
    },

    /**
     * Optionally: fetch a few sample products for each brand (useful for storefront preview)
     * Returns map brand_name -> array of product objects (basic)
     */
    // services/brandSpotlightService.js
    async fetchSampleProductsForBrands(brandNames = [], { limitPerBrand = 4 } = {}, client) {
        if (!Array.isArray(brandNames) || brandNames.length === 0) return {};

        // Pre-aggregate variant stats per product (min price, variant count)
        // Then for each brand (unnest input array) we fetch top N products (recent) via LATERAL
        const sql = `
    WITH pv AS (
      SELECT
        product_id,
        MIN(COALESCE(sale_price, price)) AS min_price,
        COUNT(id) AS variant_count
      FROM product_variants
      WHERE deleted_at IS NULL
      GROUP BY product_id
    )
    SELECT b.brand_name,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'product_sku', p.product_sku,
            'product_img', p.product_img,
            'min_price', p.min_price,
            'variant_count', p.variant_count
          )
          ORDER BY p.created_at DESC
        ) FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) AS products
    FROM UNNEST($1::text[]) AS b(brand_name)
    LEFT JOIN LATERAL (
      SELECT p2.id, p2.name, p2.product_sku, p2.product_img,
             COALESCE(pv.min_price, NULL) AS min_price,
             COALESCE(pv.variant_count, 0) AS variant_count,
             p2.created_at
      FROM products p2
      LEFT JOIN pv ON pv.product_id = p2.id
      WHERE p2.deleted_at IS NULL
        AND p2.brand_name = b.brand_name
        AND (p2.vendor_id IS NULL OR EXISTS (
          SELECT 1 FROM vendors v
          WHERE v.id = p2.vendor_id
            AND v.status = 'active'
            AND v.deleted_at IS NULL
        ))
      ORDER BY p2.created_at DESC
      LIMIT $2
    ) p ON true
    GROUP BY b.brand_name
  `;

        const { rows } = await client.query(sql, [brandNames, limitPerBrand]);

        const map = {};
        for (const r of rows) map[r.brand_name] = r.products || [];
        return map;
    }

};

module.exports = BrandSpotlightService;
