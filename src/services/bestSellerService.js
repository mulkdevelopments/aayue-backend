// services/bestSellerService.js
const { v4: uuidv4 } = require('uuid');

const BestSellerService = {
    /**
     * addBestSeller
     * payload: { product_id, vendor_id, rank, meta, active, start_at, end_at, created_by }
     * client: pg client (transaction controlled by caller)
     */
    async addBestSeller(payload, client) {
        const id = uuidv4();
        const insertSQL = `
      INSERT INTO best_sellers (
        id, product_id, vendor_id, rank, meta, active, start_at, end_at, created_by, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9, now(), now()
      ) RETURNING *
    `;
        const vals = [
            id,
            payload.product_id,
            payload.vendor_id || null,
            payload.rank || null,
            payload.meta ? JSON.stringify(payload.meta) : JSON.stringify({}),
            payload.active !== undefined ? payload.active : true,
            payload.start_at || null,
            payload.end_at || null,
            payload.created_by || null
        ];
        const { rows } = await client.query(insertSQL, vals);
        return rows[0];
    },

    async updateBestSeller(id, updates, client) {
        // build dynamic SET
        const allowed = ['rank', 'meta', 'active', 'start_at', 'end_at', 'updated_at'];
        const setParts = [];
        const vals = [];
        let idx = 1;
        for (const k of allowed) {
            if (updates[k] !== undefined) {
                setParts.push(`${k} = $${idx}`);
                vals.push(k === 'meta' ? JSON.stringify(updates[k]) : updates[k]);
                idx++;
            }
        }
        if (setParts.length === 0) return null;
        // always update updated_at
        setParts.push(`updated_at = now()`);
        const sql = `UPDATE best_sellers SET ${setParts.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
        vals.push(id);
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    async removeBestSeller(id, client) {
        // soft-delete
        const sql = `UPDATE best_sellers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
        const { rows } = await client.query(sql, [id]);
        return rows[0];
    },

    async listBestSellers({ limit = 50, offset = 0, include_inactive = false }, client) {
        const now = new Date();
        const where = [`bs.deleted_at IS NULL`];
        const params = [];
        let idx = 1;
        if (!include_inactive) {
            where.push(`bs.active = true`);
            // apply date window if present
            where.push(`(bs.start_at IS NULL OR bs.start_at <= $${idx})`);
            params.push(now);
            idx++;
            where.push(`(bs.end_at IS NULL OR bs.end_at >= $${idx})`);
            params.push(now);
            idx++;
        }
        const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const sql = `
      SELECT bs.*, p.product_sku, p.name AS product_name, p.title, p.product_img, p.default_category_id
      FROM best_sellers bs
      JOIN products p ON p.id = bs.product_id AND p.deleted_at IS NULL
      ${whereSQL}
      ORDER BY bs.rank ASC NULLS LAST, bs.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
        params.push(limit);
        params.push(offset);

        const { rows } = await client.query(sql, params);
        return rows;
    },

    async getActiveBestSellers({ limit = 20, offset = 0 }, client) {
        // returns enriched product rows (basic product info + aggregated variants nested inside product)
        const now = new Date();
        const sql = `
    WITH variant_agg AS (
      SELECT
        p.id AS product_id,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'price', pv.price,
              'mrp', pv.mrp,
              'vendorsaleprice', pv.vendorsaleprice,
              'vendormrp', pv.vendormrp,
              'stock', pv.stock,
              'variant_color', pv.variant_color,
              'variant_size', pv.variant_size,
              'images', pv.images
            )
          ) FILTER (WHERE pv.id IS NOT NULL),
          '[]'::jsonb
        ) AS variants
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      GROUP BY p.id
    )
    SELECT
      bs.id AS best_seller_id,
      bs.rank,
      bs.meta,
      -- build product json and attach variants from the CTE
      (
        (to_jsonb(p.*) - 'attributes' - 'product_meta' - 'videos')
        || jsonb_build_object('variants', va.variants)
      ) AS product
    FROM best_sellers bs
    JOIN products p ON p.id = bs.product_id AND p.deleted_at IS NULL
    LEFT JOIN variant_agg va ON va.product_id = p.id
    WHERE bs.deleted_at IS NULL
      AND bs.active = true
      AND (bs.start_at IS NULL OR bs.start_at <= $1)
      AND (bs.end_at IS NULL OR bs.end_at >= $1)
      AND (p.vendor_id IS NULL OR EXISTS (
        SELECT 1 FROM vendors v
        WHERE v.id = p.vendor_id
          AND v.status = 'active'
          AND v.deleted_at IS NULL
      ))
    ORDER BY bs.rank ASC NULLS LAST, bs.created_at DESC
    LIMIT $2 OFFSET $3
  `;
        const { rows } = await client.query(sql, [now, limit, offset]);
        return rows;
    },

    async existsForProduct(product_id, client) {
        const { rows } = await client.query(`SELECT id FROM best_sellers WHERE product_id = $1 AND deleted_at IS NULL LIMIT 1`, [product_id]);
        return rows.length > 0 ? rows[0] : null;
    }
};

module.exports = BestSellerService;
