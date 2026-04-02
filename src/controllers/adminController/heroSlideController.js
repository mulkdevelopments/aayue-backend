const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const dbPool = require("../../db/dbConnection");

/**
 * GET /admin/hero-slides
 * List all hero slides (admin).
 */
module.exports.listHeroSlides = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, title, description, image_url, redirect_url, collection_slug, sort_order, is_active, created_at, updated_at
       FROM hero_slides
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`
    );
    return sendResponse(res, 200, true, "Hero slides fetched", rows);
  } finally {
    client.release();
  }
});

/**
 * POST /admin/hero-slides
 * Create a hero slide.
 * Body: { title, description?, image_url?, redirect_url?, sort_order?, is_active? }
 */
module.exports.createHeroSlide = catchAsync(async (req, res, next) => {
  const { title, description, image_url, redirect_url, collection_slug, sort_order, is_active } = req.body || {};
  if (!title || typeof title !== "string" || !title.trim()) {
    return next(new AppError("Title is required", 400));
  }
  const client = await dbPool.connect();
  try {
    const slugVal = collection_slug != null && String(collection_slug).trim() ? String(collection_slug).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : null;
    const { rows } = await client.query(
      `INSERT INTO hero_slides (title, description, image_url, redirect_url, collection_slug, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, image_url, redirect_url, collection_slug, sort_order, is_active, created_at, updated_at`,
      [
        title.trim(),
        description != null ? String(description).trim() : null,
        image_url != null ? String(image_url).trim() || null : null,
        redirect_url != null ? String(redirect_url).trim() || "/shop" : "/shop",
        slugVal,
        Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
        typeof is_active === "boolean" ? is_active : true,
      ]
    );
    return sendResponse(res, 201, true, "Hero slide created", rows[0]);
  } finally {
    client.release();
  }
});

/**
 * PUT /admin/hero-slides/:id
 * Update a hero slide.
 */
module.exports.updateHeroSlide = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { title, description, image_url, redirect_url, collection_slug, sort_order, is_active } = req.body || {};
  const client = await dbPool.connect();
  try {
    const updates = [];
    const values = [];
    let i = 1;
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) return next(new AppError("Title cannot be empty", 400));
      updates.push(`title = $${i++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description != null ? String(description).trim() : null);
    }
    if (image_url !== undefined) {
      updates.push(`image_url = $${i++}`);
      values.push(image_url != null ? String(image_url).trim() || null : null);
    }
    if (redirect_url !== undefined) {
      updates.push(`redirect_url = $${i++}`);
      values.push(redirect_url != null ? String(redirect_url).trim() || "/shop" : "/shop");
    }
    if (collection_slug !== undefined) {
      const slugVal = collection_slug != null && String(collection_slug).trim() ? String(collection_slug).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : null;
      updates.push(`collection_slug = $${i++}`);
      values.push(slugVal);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${i++}`);
      values.push(Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0);
    }
    if (typeof is_active === "boolean") {
      updates.push(`is_active = $${i++}`);
      values.push(is_active);
    }
    if (updates.length === 0) {
      const { rows: existing } = await client.query(
        `SELECT id, title, description, image_url, redirect_url, collection_slug, sort_order, is_active, created_at, updated_at
         FROM hero_slides WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!existing.length) return next(new AppError("Hero slide not found", 404));
      return sendResponse(res, 200, true, "Hero slide unchanged", existing[0]);
    }
    updates.push(`updated_at = now()`);
    values.push(id);
    const { rows } = await client.query(
      `UPDATE hero_slides SET ${updates.join(", ")} WHERE id = $${i} AND deleted_at IS NULL
       RETURNING id, title, description, image_url, redirect_url, collection_slug, sort_order, is_active, created_at, updated_at`,
      values
    );
    if (!rows.length) return next(new AppError("Hero slide not found", 404));
    return sendResponse(res, 200, true, "Hero slide updated", rows[0]);
  } finally {
    client.release();
  }
});

/**
 * DELETE /admin/hero-slides/:id
 * Soft-delete a hero slide.
 */
module.exports.deleteHeroSlide = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const client = await dbPool.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE hero_slides SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (rowCount === 0) return next(new AppError("Hero slide not found", 404));
    return sendResponse(res, 200, true, "Hero slide deleted", null);
  } finally {
    client.release();
  }
});

/**
 * GET /admin/hero-slides/:id/products
 * List hand-picked product IDs for a hero slide (curated collection).
 */
module.exports.getHeroSlideProducts = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT hsp.product_id, hsp.sort_order,
              p.name AS product_name, p.product_img
       FROM hero_slide_products hsp
       LEFT JOIN products p ON p.id = hsp.product_id AND p.deleted_at IS NULL
       WHERE hsp.hero_slide_id = $1
       ORDER BY hsp.sort_order ASC`,
      [id]
    );
    const list = rows.map((r) => ({
      product_id: r.product_id,
      sort_order: r.sort_order,
      product_name: r.product_name || null,
      product_img: r.product_img || null,
    }));
    return sendResponse(res, 200, true, "Hero slide products", list);
  } finally {
    client.release();
  }
});

/**
 * PUT /admin/hero-slides/:id/products
 * Set hand-picked products for a hero slide (20+). Body: { product_ids: [uuid, ...] } — order = sort_order.
 */
module.exports.setHeroSlideProducts = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { product_ids: productIds } = req.body || {};
  const client = await dbPool.connect();
  try {
    const exists = await client.query(
      `SELECT id FROM hero_slides WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!exists.rows.length) return next(new AppError("Hero slide not found", 404));

    const ids = Array.isArray(productIds) ? productIds.filter((x) => x && typeof x === "string") : [];
    await client.query(`DELETE FROM hero_slide_products WHERE hero_slide_id = $1`, [id]);
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `INSERT INTO hero_slide_products (hero_slide_id, product_id, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (hero_slide_id, product_id) DO UPDATE SET sort_order = $3`,
        [id, ids[i], i]
      );
    }
    const { rows } = await client.query(
      `SELECT hsp.product_id, hsp.sort_order,
              p.name AS product_name, p.product_img
       FROM hero_slide_products hsp
       LEFT JOIN products p ON p.id = hsp.product_id AND p.deleted_at IS NULL
       WHERE hsp.hero_slide_id = $1
       ORDER BY hsp.sort_order ASC`,
      [id]
    );
    const list = rows.map((r) => ({
      product_id: r.product_id,
      sort_order: r.sort_order,
      product_name: r.product_name || null,
      product_img: r.product_img || null,
    }));
    return sendResponse(res, 200, true, "Hero slide products updated", list);
  } finally {
    client.release();
  }
});
