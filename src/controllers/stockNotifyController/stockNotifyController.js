const { randomUUID } = require("crypto");
const db = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUSES = new Set(["pending", "notified", "closed"]);

// PUBLIC: Create stock notify request
module.exports.createStockNotifyRequest = catchAsync(async (req, res, next) => {
  const {
    product_id,
    product_name,
    brand_name,
    product_image,
    requested_size,
    email,
    wants_marketing = false,
  } = req.body || {};

  if (!product_id) {
    return next(new AppError("product_id is required", 400));
  }

  if (!email) {
    return next(new AppError("Email is required", 400));
  }

  const emailTrimmed = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(emailTrimmed)) {
    return next(new AppError("Invalid email format", 400));
  }

  const id = randomUUID();
  const sql = `
    INSERT INTO stock_notify_requests (
      id,
      product_id,
      product_name,
      brand_name,
      product_image,
      requested_size,
      email,
      wants_marketing,
      status,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',NOW(),NOW())
    ON CONFLICT (product_id, requested_size, email)
    WHERE deleted_at IS NULL
    DO UPDATE SET
      wants_marketing = EXCLUDED.wants_marketing,
      updated_at = NOW(),
      status = CASE
        WHEN stock_notify_requests.status = 'closed' THEN 'pending'
        ELSE stock_notify_requests.status
      END
    RETURNING *
  `;

  const result = await db.query(sql, [
    id,
    product_id,
    product_name || null,
    brand_name || null,
    product_image || null,
    requested_size || null,
    emailTrimmed,
    !!wants_marketing,
  ]);

  return sendResponse(res, 200, true, "Request saved", result.rows[0]);
});

// ADMIN: List stock notify requests
module.exports.listStockNotifyRequests = catchAsync(async (req, res, next) => {
  const { status, q, limit = 50, offset = 0 } = req.query;

  const params = [];
  let where = "deleted_at IS NULL";

  if (status && VALID_STATUSES.has(status)) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where += `
      AND (
        LOWER(email) LIKE $${params.length}
        OR LOWER(product_name) LIKE $${params.length}
        OR LOWER(brand_name) LIKE $${params.length}
        OR LOWER(requested_size) LIKE $${params.length}
      )
    `;
  }

  const limitVal = Math.min(200, Math.max(1, Number(limit) || 50));
  const offsetVal = Math.max(0, Number(offset) || 0);

  params.push(limitVal, offsetVal);

  const dataSql = `
    SELECT *
    FROM stock_notify_requests
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM stock_notify_requests
    WHERE ${where}
  `;

  const [dataRes, countRes] = await Promise.all([
    db.query(dataSql, params),
    db.query(countSql, params.slice(0, params.length - 2)),
  ]);

  return sendResponse(res, 200, true, "Requests fetched", {
    items: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
  });
});

// ADMIN: Update status
module.exports.updateStockNotifyRequest = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!id) return next(new AppError("Request ID is required", 400));
  if (!status || !VALID_STATUSES.has(status)) {
    return next(new AppError("Invalid status", 400));
  }

  const sql = `
    UPDATE stock_notify_requests
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND deleted_at IS NULL
    RETURNING *
  `;

  const result = await db.query(sql, [status, id]);
  if (result.rowCount === 0) {
    return next(new AppError("Request not found", 404));
  }

  return sendResponse(res, 200, true, "Request updated", result.rows[0]);
});

// ADMIN: Delete request
module.exports.deleteStockNotifyRequest = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  if (!id) return next(new AppError("Request ID is required", 400));

  const result = await db.query(
    `DELETE FROM stock_notify_requests WHERE id = $1 RETURNING id`,
    [id]
  );

  if (result.rowCount === 0) {
    return next(new AppError("Request not found", 404));
  }

  return sendResponse(res, 200, true, "Request deleted");
});
