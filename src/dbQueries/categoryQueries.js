const categoryQueries = {
  // getById: `SELECT id, name, slug, parent_id, lft, rgt, path FROM categories WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
  getBySlug: `SELECT id FROM categories WHERE slug = $1 AND deleted_at IS NULL`,
  getMaxRgt: `SELECT COALESCE(MAX(rgt), 0) as max_rgt FROM categories`,
  /**
  insertCategory: `
    INSERT INTO categories (id, name, slug, parent_id, lft, rgt, path, is_active, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9, now())
    RETURNING id, name, slug, parent_id, lft, rgt, path, is_active, metadata, created_at
  `,
  */

  updateShiftLeft: `UPDATE categories SET lft = lft + 2 WHERE lft > $1`,
  updateShiftRight: `UPDATE categories SET rgt = rgt + 2 WHERE rgt >= $1`,
  /**
  updateCategory: `
        UPDATE categories
        SET 
            name = $2,
            slug = $3,
            parent_id = $4,
            path = $5,
            is_active = $6,
            metadata = $7
        WHERE id = $1
        RETURNING *;
    `
    */
  // in categoryQueries (extend selected fields)
  getById: `SELECT id, name, slug, parent_id, lft, rgt, path, our_category, is_our_category, metadata, image_url FROM categories WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,

  // ensure insert returns new fields
  insertCategory: `
  INSERT INTO categories (id, name, slug, parent_id, lft, rgt, path, is_active, metadata, created_at, our_category, is_our_category, priority, image_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9, now(), $10, COALESCE($11, false), $12, $13)
  RETURNING id, name, slug, parent_id, lft, rgt, path, is_active, metadata, created_at, our_category, is_our_category, priority, image_url
`,
  updateCategory: `
  UPDATE categories
  SET
    name = $2,
    slug = $3,
    parent_id = $4,
    path = $5,
    is_active = $6,
    metadata = $7,
    our_category = $8,
    is_our_category = $9,
    priority = $10,
    image_url = $11
  WHERE id = $1
  RETURNING *
`

};

module.exports = categoryQueries;