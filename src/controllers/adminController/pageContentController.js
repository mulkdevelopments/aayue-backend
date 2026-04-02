const dbPool = require("../../db/dbConnection");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");

const ALLOWED_KEYS = ["faq", "how_to_shop"];

function isValidKey(key) {
  return typeof key === "string" && ALLOWED_KEYS.includes(key.trim().toLowerCase());
}

/** GET page content by key (admin or public). Public route uses getPageContentPublic. */
module.exports.getPageContent = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const key = (req.query.key || "").trim().toLowerCase();
    if (!isValidKey(key)) {
      client.release();
      return next(new AppError("Invalid key. Use faq or how_to_shop", 400));
    }
    const { rows } = await client.query(
      "SELECT key, content, updated_at FROM page_content WHERE key = $1 LIMIT 1",
      [key]
    );
    const data = rows[0] ? { key: rows[0].key, content: rows[0].content, updated_at: rows[0].updated_at } : null;
    return sendResponse(res, 200, true, "Page content", data);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/** GET /api/.../page-content?key=faq|how_to_shop (public, no auth) */
module.exports.getPageContentPublic = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const key = (req.query.key || "").trim().toLowerCase();
    if (!isValidKey(key)) {
      client.release();
      return next(new AppError("Invalid key. Use faq or how_to_shop", 400));
    }
    const { rows } = await client.query(
      "SELECT key, content FROM page_content WHERE key = $1 LIMIT 1",
      [key]
    );
    const data = rows[0] ? { key: rows[0].key, content: rows[0].content } : null;
    return sendResponse(res, 200, true, "Page content", data);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/** POST /admin/page-content (admin) — body: { key, content } */
module.exports.savePageContent = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const key = (req.body?.key || "").trim().toLowerCase();
    const content = req.body?.content;
    if (!isValidKey(key)) {
      client.release();
      return next(new AppError("Invalid key. Use faq or how_to_shop", 400));
    }
    if (content === undefined || content === null) {
      client.release();
      return next(new AppError("content is required", 400));
    }
    const contentJson = typeof content === "string" ? content : JSON.stringify(content);
    await client.query(
      `INSERT INTO page_content (key, content, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET content = $2::jsonb, updated_at = NOW()`,
      [key, contentJson]
    );
    const { rows } = await client.query(
      "SELECT key, content, updated_at FROM page_content WHERE key = $1",
      [key]
    );
    const data = rows[0] ? { key: rows[0].key, content: rows[0].content, updated_at: rows[0].updated_at } : null;
    return sendResponse(res, 200, true, "Page content saved", data);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});
