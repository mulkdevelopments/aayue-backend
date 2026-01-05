// services/newArrivalService.js
const { v4: uuidv4 } = require('uuid');

const NewArrivalService = {
  async createNewArrival({ product_id, rank = null, meta = {}, active = true, start_at = null, end_at = null, created_by = null }, client) {
    const id = uuidv4();
    const sql = `
      INSERT INTO new_arrivals (id, product_id, rank, meta, active, start_at, end_at, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8, now(), now())
      RETURNING *;
    `;
    const vals = [id, product_id, rank, JSON.stringify(meta || {}), active, start_at, end_at, created_by];
    const { rows } = await client.query(sql, vals);
    return rows[0];
  },

  async updateNewArrival(id, updates, client) {
    const allowed = ['rank', 'meta', 'active', 'start_at', 'end_at'];
    const parts = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        parts.push(`${key} = $${idx}`);
        vals.push(key === 'meta' ? JSON.stringify(updates[key] || {}) : updates[key]);
        idx++;
      }
    }
    if (parts.length === 0) return null;
    parts.push('updated_at = now()');
    const sql = `UPDATE new_arrivals SET ${parts.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
    vals.push(id);
    const { rows } = await client.query(sql, vals);
    return rows[0];
  },

  async deleteNewArrival(id, client) {
    const sql = `UPDATE new_arrivals SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
    const { rows } = await client.query(sql, [id]);
    return rows[0];
  },

  async listNewArrivals({ limit = 50, offset = 0, include_inactive = false }, client) {
    // Admin listing (no heavy enrichment)
    const now = new Date();
    const where = ['na.deleted_at IS NULL'];
    const params = [];
    let idx = 1;

    if (!include_inactive) {
      where.push(`na.active = true`);
      where.push(`(na.start_at IS NULL OR na.start_at <= $${idx})`); params.push(now); idx++;
      where.push(`(na.end_at IS NULL OR na.end_at >= $${idx})`); params.push(now); idx++;
    }

    const whereSQL = `WHERE ${where.join(' AND ')}`;
    const sql = `
      SELECT na.*
      FROM new_arrivals na
      ${whereSQL}
      ORDER BY na.rank ASC NULLS LAST, na.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);
    const { rows } = await client.query(sql, params);
    return rows;
  },

  /**
   * Fetch active new arrivals enriched with product + nested variants.
   * Returns array of { new_arrival_id, rank, meta, product: {...with variants...} }
   */
  async fetchActiveNewArrivals({ limit = 20, offset = 0 }, client) {
    const now = new Date();

    // For each new_arrival row we fetch product + variants via LATERAL to avoid nested aggregates
    // product_json contains product fields (excluding heavy fields if desired)
    // variants_json is an array of variant objects
    const sql = `
      SELECT
        na.id AS new_arrival_id,
        na.rank,
        na.meta,
        p.product
      FROM (
        SELECT id, product_id, rank, meta
        FROM new_arrivals
        WHERE deleted_at IS NULL
          AND active = true
          AND (start_at IS NULL OR start_at <= $1)
          AND (end_at IS NULL OR end_at >= $1)
        ORDER BY rank ASC NULLS LAST, created_at DESC
        LIMIT $2 OFFSET $3
      ) na
      JOIN LATERAL (
        SELECT to_jsonb(prod_base) || jsonb_build_object('variants', COALESCE(v.variants, '[]'::jsonb)) AS product
        FROM (
          SELECT p.id, p.vendor_id, p.productid, p.product_sku, p.name, p.title, p.short_description,
                 p.description, p.brand_name, p.gender, p.default_category_id, p.product_img, p.product_img1,
                 p.product_img2, p.product_img3, p.product_img4, p.product_img5, p.country_of_origin,
                 p.is_active, p.created_at, p.updated_at
          FROM products p
          WHERE p.id = na.product_id
            AND p.deleted_at IS NULL
            AND (p.vendor_id IS NULL OR EXISTS (
              SELECT 1 FROM vendors v
              WHERE v.id = p.vendor_id
                AND v.status = 'active'
                AND v.deleted_at IS NULL
            ))
          LIMIT 1
        ) prod_base
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
            'id', pv.id,
            'sku', pv.sku,
            'price', pv.price,
            'mrp', pv.mrp,
            'vendorsaleprice', pv.vendorsaleprice,
            'vendormrp', pv.vendormrp,
            'stock', pv.stock,
            'variant_color', pv.variant_color,
            'variant_size', pv.variant_size,
            'images', pv.images,
            'attributes', pv.attributes,
            'country_of_origin', pv.country_of_origin
          ) ORDER BY pv.created_at DESC) FILTER (WHERE pv.id IS NOT NULL) AS variants
          FROM product_variants pv
          WHERE pv.product_id = prod_base.id AND pv.deleted_at IS NULL
        ) v ON true
      ) p ON true
      ORDER BY na.rank ASC NULLS LAST;
    `;

    const { rows } = await client.query(sql, [now, limit, offset]);
    // rows already contain new_arrival_id, rank, meta, product (product includes 'variants' array)
    return rows;
  }
};

module.exports = NewArrivalService;
