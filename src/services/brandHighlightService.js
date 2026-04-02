const { randomUUID } = require("crypto");

const BrandHighlightService = {
  async listAdmin({ includeInactive = true } = {}, client) {
    const where = ["deleted_at IS NULL"];
    if (!includeInactive) where.push("active = true");
    const { rows } = await client.query(
      `
      SELECT id, brand_name, display_label, image_url, link_url, sort_order, active,
             created_at, updated_at
      FROM brand_highlights
      WHERE ${where.join(" AND ")}
      ORDER BY sort_order ASC NULLS LAST, brand_name ASC
      `
    );
    return rows;
  },

  async listActivePublic(client) {
    const { rows } = await client.query(
      `
      SELECT id, brand_name, display_label, image_url, link_url, sort_order
      FROM brand_highlights
      WHERE deleted_at IS NULL AND active = true
      ORDER BY sort_order ASC NULLS LAST, brand_name ASC
      LIMIT 12
      `
    );
    return rows;
  },

  async getById(id, client) {
    const { rows } = await client.query(
      `
      SELECT id, brand_name, display_label, image_url, link_url, sort_order, active
      FROM brand_highlights
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
      `,
      [id]
    );
    return rows[0] || null;
  },

  async create(
    { brand_name, display_label, image_url, link_url, sort_order, active = true },
    client
  ) {
    if (!brand_name || !image_url) {
      throw new Error("brand_name and image_url are required");
    }
    const id = randomUUID();
    const { rows } = await client.query(
      `
      INSERT INTO brand_highlights
        (id, brand_name, display_label, image_url, link_url, sort_order, active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
      RETURNING id, brand_name, display_label, image_url, link_url, sort_order, active, created_at, updated_at
      `,
      [
        id,
        String(brand_name).trim(),
        display_label != null ? String(display_label).trim() || null : null,
        String(image_url).trim(),
        link_url != null && String(link_url).trim() ? String(link_url).trim() : null,
        Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
        !!active,
      ]
    );
    return rows[0];
  },

  async update(
    id,
    { brand_name, display_label, image_url, link_url, sort_order, active },
    client
  ) {
    const parts = [];
    const vals = [];
    let i = 1;
    if (brand_name !== undefined) {
      parts.push(`brand_name = $${i++}`);
      vals.push(String(brand_name).trim());
    }
    if (display_label !== undefined) {
      parts.push(`display_label = $${i++}`);
      vals.push(
        display_label === null || display_label === ""
          ? null
          : String(display_label).trim()
      );
    }
    if (image_url !== undefined) {
      parts.push(`image_url = $${i++}`);
      vals.push(String(image_url).trim());
    }
    if (link_url !== undefined) {
      parts.push(`link_url = $${i++}`);
      vals.push(
        link_url === null || link_url === ""
          ? null
          : String(link_url).trim()
      );
    }
    if (sort_order !== undefined) {
      parts.push(`sort_order = $${i++}`);
      vals.push(Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0);
    }
    if (active !== undefined) {
      parts.push(`active = $${i++}`);
      vals.push(!!active);
    }
    if (!parts.length) return null;
    parts.push("updated_at = now()");
    vals.push(id);
    const { rows } = await client.query(
      `
      UPDATE brand_highlights
      SET ${parts.join(", ")}
      WHERE id = $${i} AND deleted_at IS NULL
      RETURNING id, brand_name, display_label, image_url, link_url, sort_order, active, updated_at
      `,
      vals
    );
    return rows[0] || null;
  },

  async softDelete(id, client) {
    const { rows } = await client.query(
      `
      UPDATE brand_highlights
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, image_url
      `,
      [id]
    );
    return rows[0] || null;
  },
};

module.exports = BrandHighlightService;
