const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const { isValidUUID } = require("../../utils/basicValidation");

const SAFE_ADMIN_COLUMNS =
  "id, email, name, role, is_active, receive_order_notifications, allowed_routes, created_at, updated_at";

/**
 * GET /admin/admins
 * List all admins (superadmin only). Excludes sensitive fields.
 */
module.exports.listAdmins = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT ${SAFE_ADMIN_COLUMNS}
       FROM admins
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`
    );
    return sendResponse(res, 200, true, "Admins fetched", rows);
  } finally {
    client.release();
  }
});

/**
 * PATCH /admin/admins/:id
 * Update an admin's role, is_active, receive_order_notifications, allowed_routes (superadmin only).
 */
module.exports.updateAdmin = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { role, is_active, receive_order_notifications, allowed_routes } = req.body;

  if (!isValidUUID(id)) return next(new AppError("Invalid admin id", 400));

  const client = await dbPool.connect();
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (typeof role === "string" && role.trim()) {
      updates.push(`role = $${idx}`);
      values.push(role.trim());
      idx++;
    }
    if (typeof is_active === "boolean") {
      updates.push(`is_active = $${idx}`);
      values.push(is_active);
      idx++;
    }
    if (typeof receive_order_notifications === "boolean") {
      updates.push(`receive_order_notifications = $${idx}`);
      values.push(receive_order_notifications);
      idx++;
    }
    if (Array.isArray(allowed_routes)) {
      updates.push(`allowed_routes = $${idx}`);
      values.push(JSON.stringify(allowed_routes.filter((r) => typeof r === "string")));
      idx++;
    }

    if (updates.length === 0) {
      return next(new AppError("No valid fields to update", 400));
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const { rowCount, rows } = await client.query(
      `UPDATE admins
       SET ${updates.join(", ")}
       WHERE id = $${idx} AND deleted_at IS NULL
       RETURNING ${SAFE_ADMIN_COLUMNS}`,
      values
    );

    if (rowCount === 0) return next(new AppError("Admin not found", 404));
    return sendResponse(res, 200, true, "Admin updated", rows[0]);
  } finally {
    client.release();
  }
});
