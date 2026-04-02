const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const dbPool = require("../../db/dbConnection");

/**
 * GET /users/get-hero-slides
 * Public: active hero slides for homepage hero section, ordered by sort_order.
 */
module.exports.getActiveHeroSlides = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, title, description, image_url, redirect_url, collection_slug, sort_order
       FROM hero_slides
       WHERE deleted_at IS NULL AND is_active = true
       ORDER BY sort_order ASC, created_at ASC`
    );
    return sendResponse(res, 200, true, "Hero slides fetched", rows);
  } finally {
    client.release();
  }
});
