// // services/saleService.js
// const { randomUUID } = require("crypto");
// const SaleService = {
//     async createSale({ product_id, rank = null, meta = {}, active = true, start_at = null, end_at = null, created_by = null }, client) {
//         const id = randomUUID();
//         const sql = `
//       INSERT INTO sales (id, product_id, rank, meta, active, start_at, end_at, created_by, created_at, updated_at)
//       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8, now(), now())
//       RETURNING *;
//     `;
//         const vals = [id, product_id, rank, JSON.stringify(meta || {}), active, start_at, end_at, created_by];
//         const { rows } = await client.query(sql, vals);
//         return rows[0];
//     },

//     async updateSale(id, updates, client) {
//         const allowed = ['rank', 'meta', 'active', 'start_at', 'end_at'];
//         const parts = [];
//         const vals = [];
//         let idx = 1;
//         for (const key of allowed) {
//             if (updates[key] !== undefined) {
//                 parts.push(`${key} = $${idx}`);
//                 vals.push(key === 'meta' ? JSON.stringify(updates[key] || {}) : updates[key]);
//                 idx++;
//             }
//         }
//         if (parts.length === 0) return null;
//         parts.push('updated_at = now()');
//         const sql = `UPDATE sales SET ${parts.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
//         vals.push(id);
//         const { rows } = await client.query(sql, vals);
//         return rows[0];
//     },

// async deleteSale(id, client) {
//     const sql = `UPDATE sales SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
//     const { rows } = await client.query(sql, [id]);
//     return rows[0];
// },

// async listSales({ limit = 50, offset = 0, include_inactive = false }, client) {
//     const now = new Date();
//     const where = ['s.deleted_at IS NULL'];
//     const params = [];
//     let idx = 1;

//     if (!include_inactive) {
//         where.push(`s.active = true`);
//         where.push(`(s.start_at IS NULL OR s.start_at <= $${idx})`); params.push(now); idx++;
//         where.push(`(s.end_at IS NULL OR s.end_at >= $${idx})`); params.push(now); idx++;
//     }

//     const whereSQL = `WHERE ${where.join(' AND ')}`;
//     const sql = `
//   SELECT s.*
//   FROM sales s
//   ${whereSQL}
//   ORDER BY s.rank ASC NULLS LAST, s.created_at DESC
//   LIMIT $${idx} OFFSET $${idx + 1}
// `;
//     params.push(limit, offset);
//     const { rows } = await client.query(sql, params);
//     return rows;
// },

//     /**
//      * Fetch active sales enriched with product + nested variants.
//      * Returns rows with: sale_id, rank, meta, product { ... product fields ..., variants: [...] }
//      */
//     async fetchActiveSales({ limit = 20, offset = 0 }, client) {
//         const now = new Date();
//         const sql = `
//       SELECT
//         s.id AS sale_id,
//         s.rank,
//         s.meta,
//         p.product
//       FROM (
//         SELECT id, product_id, rank, meta
//         FROM sales
//         WHERE deleted_at IS NULL
//           AND active = true
//           AND (start_at IS NULL OR start_at <= $1)
//           AND (end_at IS NULL OR end_at >= $1)
//         ORDER BY rank ASC NULLS LAST, created_at DESC
//         LIMIT $2 OFFSET $3
//       ) s
//       JOIN LATERAL (
//         SELECT to_jsonb(prod_base) || jsonb_build_object('variants', COALESCE(v.variants, '[]'::jsonb)) AS product
//         FROM (
//           SELECT p.id, p.vendor_id, p.productid, p.product_sku, p.name, p.title, p.short_description,
//                  p.description, p.brand_name, p.gender, p.default_category_id, p.product_img, p.product_img1,
//                  p.product_img2, p.product_img3, p.product_img4, p.product_img5, p.country_of_origin,
//                  p.is_active, p.created_at, p.updated_at
//           FROM products p
//           WHERE p.id = s.product_id AND p.deleted_at IS NULL
//           LIMIT 1
//         ) prod_base
//         LEFT JOIN LATERAL (
//           SELECT jsonb_agg(jsonb_build_object(
//             'id', pv.id,
//             'sku', pv.sku,
//             'price', pv.price,
//             'mrp', pv.mrp,
//             'sale_price', pv.sale_price,
//             'stock', pv.stock,
//             'variant_color', pv.variant_color,
//             'variant_size', pv.variant_size,
//             'images', pv.images,
//             'attributes', pv.attributes,
//             'country_of_origin', pv.country_of_origin
//           ) ORDER BY pv.created_at DESC) FILTER (WHERE pv.id IS NOT NULL) AS variants
//           FROM product_variants pv
//           WHERE pv.product_id = prod_base.id AND pv.deleted_at IS NULL
//         ) v ON true
//       ) p ON true
//       ORDER BY s.rank ASC NULLS LAST, s.created_at DESC;
//     `;

//         const { rows } = await client.query(sql, [now, limit, offset]);
//         return rows;
//     }
// };

// module.exports = SaleService;


// services/saleService.js
const { randomUUID } = require("crypto");
const { update } = require('../controllers/adminController/newArrivalController');

const SaleService = {
    async createSaleByCategory({ image_url, redirect_url, title, button_text, created_by = null }, client) {
        const id = randomUUID();
        const sql = `
      INSERT INTO sale_by_category (id, image_url, redirect_url, title, button_text, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6, now(), now())
      RETURNING *;
    `;
        const vals = [id, image_url, redirect_url, title, button_text, created_by];
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },
    async updateSaleByCategory(id, updates, client) {
        const allowed = ['image_url', 'redirect_url', 'title', 'button_text'];
        const parts = [];
        const vals = [];
        let idx = 1;
        for (const [k, v] of Object.entries(updates)) {
            if (allowed.includes(k)) {
                parts.push(`${k} = $${idx}`);
                vals.push(v);
                idx++;
            }
        }
        const sql = `UPDATE sale_by_category SET ${parts.join(', ')} WHERE id = $${idx} RETURNING *`;
        vals.push(id);
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    //hard delete
    async deleteSaleByCategory(id, client) {
        const sql = `DELETE FROM sale_by_category WHERE id = $1 RETURNING *`;
        const { rows } = await client.query(sql, [id]);
        return rows[0];
    },

    async listSaleByCategories({ limit = 50, offset = 0 }, client) {
        const sql = `
      SELECT *
      FROM sale_by_category
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
        const { rows } = await client.query(sql, [limit, offset]);
        return rows;
    },

    async createSale({ product_id, discount_percent = 0, rank = null, meta = {}, active = true, start_at = null, end_at = null, created_by = null }, client) {
        const id = randomUUID();
        const sql = `
      INSERT INTO sales (id, product_id, rank, meta, discount_percent, active, start_at, end_at, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9, now(), now())
      RETURNING *;
    `;
        const vals = [id, product_id, rank, JSON.stringify(meta || {}), discount_percent, active, start_at, end_at, created_by];
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    async listSales({ limit = 50, offset = 0, include_inactive = false }, client) {
        const now = new Date();
        const where = ['s.deleted_at IS NULL'];
        const params = [];
        let idx = 1;

        if (!include_inactive) {
            where.push(`s.active = true`);
            where.push(`(s.start_at IS NULL OR s.start_at <= $${idx})`); params.push(now); idx++;
            where.push(`(s.end_at IS NULL OR s.end_at >= $${idx})`); params.push(now); idx++;
        }

        const whereSQL = `WHERE ${where.join(' AND ')}`;
        const sql = `
      SELECT s.*
      FROM sales s
      ${whereSQL}
      ORDER BY s.rank ASC NULLS LAST, s.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
        params.push(limit, offset);
        const { rows } = await client.query(sql, params);
        return rows;
    },

    async updateSale(id, updates, client) {
        const allowed = ['rank', 'meta', 'active', 'start_at', 'end_at', 'discount_percent'];
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

        const sql = `UPDATE sales SET ${parts.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`;
        vals.push(id);
        const { rows } = await client.query(sql, vals);
        return rows[0];
    },

    async deleteSale(id, client) {
        const sql = `UPDATE sales SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
        const { rows } = await client.query(sql, [id]);
        return rows[0];
    },

    async fetchActiveSales({ limit = 20, offset = 0 }, client) {
        const now = new Date();

        const sql = `
      SELECT
        s.id AS sale_id,
        s.rank,
        s.meta,
        s.discount_percent,
        to_jsonb(p.*) AS product,
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', pv.id,
          'sku', pv.sku,
          'mrp', pv.mrp,
          'price', pv.price,
          'sale_price', ROUND(pv.price - (pv.price * s.discount_percent / 100), 2),
          'stock', pv.stock,
          'variant_color', pv.variant_color,
          'variant_size', pv.variant_size,
          'images', pv.images
        )) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants
      FROM sales s
      JOIN products p ON p.id = s.product_id AND p.deleted_at IS NULL
      LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
        AND s.active = true
        AND (s.start_at IS NULL OR s.start_at <= $1)
        AND (s.end_at IS NULL OR s.end_at >= $1)
        AND (p.vendor_id IS NULL OR EXISTS (
          SELECT 1 FROM vendors v
          WHERE v.id = p.vendor_id
            AND v.status = 'active'
            AND v.deleted_at IS NULL
        ))
      GROUP BY s.id, p.id
      ORDER BY s.rank ASC NULLS LAST, s.created_at DESC
      LIMIT $2 OFFSET $3;
    `;

        const { rows } = await client.query(sql, [now, limit, offset]);
        return rows.map(r => ({
            sale_id: r.sale_id,
            rank: r.rank,
            discount_percent: Number(r.discount_percent || 0),
            meta: r.meta,
            product: {
                ...r.product,
                variants: r.variants
            }
        }));
    }
};

module.exports = SaleService;
