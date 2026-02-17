const { randomUUID } = require("crypto");

const slugify = (name = "") =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const BrandGroupService = {
  async listGroups({ includeInactive = true } = {}, client) {
    const where = ["deleted_at IS NULL"];
    if (!includeInactive) where.push("active = true");
    const sql = `
      SELECT id, name, slug, meta, rank, active, created_at, updated_at
      FROM brand_groups
      WHERE ${where.join(" AND ")}
      ORDER BY rank ASC NULLS LAST, name ASC
    `;
    const { rows } = await client.query(sql);
    return rows;
  },

  async createGroup({ name, rank, active = true, meta = {} }, client) {
    const id = randomUUID();
    const slug = slugify(name);
    const sql = `
      INSERT INTO brand_groups
        (id, name, slug, meta, rank, active, created_at, updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,now(),now())
      RETURNING id, name, slug, meta, rank, active, created_at, updated_at
    `;
    const vals = [id, name, slug, JSON.stringify(meta || {}), rank || null, active];
    const { rows } = await client.query(sql, vals);
    return rows[0];
  },

  async updateGroup(id, { name, rank, active, meta }, client) {
    const parts = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) {
      parts.push(`name = $${idx}`);
      vals.push(name);
      idx++;
      parts.push(`slug = $${idx}`);
      vals.push(slugify(name));
      idx++;
    }
    if (rank !== undefined) {
      parts.push(`rank = $${idx}`);
      vals.push(rank);
      idx++;
    }
    if (active !== undefined) {
      parts.push(`active = $${idx}`);
      vals.push(active);
      idx++;
    }
    if (meta !== undefined) {
      parts.push(`meta = $${idx}::jsonb`);
      vals.push(JSON.stringify(meta || {}));
      idx++;
    }
    if (!parts.length) return null;
    parts.push("updated_at = now()");
    const sql = `
      UPDATE brand_groups
      SET ${parts.join(", ")}
      WHERE id = $${idx} AND deleted_at IS NULL
      RETURNING id, name, slug, meta, rank, active, created_at, updated_at
    `;
    vals.push(id);
    const { rows } = await client.query(sql, vals);
    return rows[0];
  },

  async deleteGroup(id, client) {
    const sql = `
      UPDATE brand_groups
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;
    const { rows } = await client.query(sql, [id]);
    return rows[0];
  },

  async listGroupBrands(groupId, client) {
    const sql = `
      SELECT id, brand_name, rank
      FROM brand_group_brands
      WHERE group_id = $1 AND deleted_at IS NULL
      ORDER BY rank ASC NULLS LAST, brand_name ASC
    `;
    const { rows } = await client.query(sql, [groupId]);
    return rows;
  },

  async addGroupBrand({ group_id, brand_name, rank }, client) {
    const id = randomUUID();
    const sql = `
      INSERT INTO brand_group_brands
        (id, group_id, brand_name, rank, created_at, updated_at)
      VALUES ($1,$2,$3,$4,now(),now())
      RETURNING id, group_id, brand_name, rank
    `;
    const vals = [id, group_id, brand_name, rank || null];
    const { rows } = await client.query(sql, vals);
    return rows[0];
  },

  async deleteGroupBrand(id, client) {
    const sql = `
      UPDATE brand_group_brands
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;
    const { rows } = await client.query(sql, [id]);
    return rows[0];
  },

  async listActiveGroupsWithBrands(client, { categorySlug } = {}) {
    const params = [];
    let cte = "";
    let brandFilter = "";
    let groupFilter = "";

    const normalizedBrandExpr = (alias) => `
      LOWER(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            unaccent(
              translate(TRIM(${alias}.brand_name), '¹²³⁴⁵⁶⁷⁸⁹⁰', '1234567890')
            ),
            '[^a-zA-Z0-9]+',
            ' ',
            'g'
          ),
          '\\s+',
          ' ',
          'g'
        )
      )
    `;

    const categoryBrandExists = (alias) => `
      EXISTS (
        SELECT 1
        FROM products p
        LEFT JOIN vendors v ON v.id = p.vendor_id
        JOIN product_our_category_map pom ON pom.product_id = p.id
        JOIN our_subtree os ON os.id = pom.our_category_id
        WHERE p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND (v.status = 'active' OR p.vendor_id IS NULL)
          AND p.brand_name_normalized = ${normalizedBrandExpr(alias)}
      )
    `;

    if (categorySlug) {
      params.push(categorySlug);
      cte = `
        WITH RECURSIVE our_subtree AS (
          SELECT id
          FROM categories
          WHERE slug = $1 AND is_our_category = true AND deleted_at IS NULL
          UNION ALL
          SELECT c.id
          FROM categories c
          INNER JOIN our_subtree os ON c.parent_id = os.id
          WHERE c.deleted_at IS NULL
        )
      `;
      brandFilter = `AND ${categoryBrandExists("b")}`;
      groupFilter = `
        AND EXISTS (
          SELECT 1
          FROM brand_group_brands b2
          WHERE b2.group_id = g.id
            AND b2.deleted_at IS NULL
            AND ${categoryBrandExists("b2")}
        )
      `;
    }

    const sql = `
      ${cte}
      SELECT
        g.id,
        g.name,
        g.slug,
        g.rank,
        g.meta,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', b.id,
              'brand_name', b.brand_name,
              'rank', b.rank
            )
            ORDER BY b.rank ASC NULLS LAST, b.brand_name ASC
          ) FILTER (WHERE b.id IS NOT NULL),
          '[]'::jsonb
        ) AS brands
      FROM brand_groups g
      LEFT JOIN brand_group_brands b
        ON b.group_id = g.id AND b.deleted_at IS NULL
        ${brandFilter}
      WHERE g.deleted_at IS NULL AND g.active = true
        ${groupFilter}
      GROUP BY g.id
      ORDER BY g.rank ASC NULLS LAST, g.name ASC
    `;
    const { rows } = await client.query(sql, params);
    return rows;
  },
};

module.exports = BrandGroupService;
