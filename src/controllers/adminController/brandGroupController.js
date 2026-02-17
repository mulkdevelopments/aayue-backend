const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const BrandGroupService = require("../../services/brandGroupService");

module.exports.listGroupsAdmin = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const includeInactive = String(req.query.include_inactive || "true") === "true";
    const rows = await BrandGroupService.listGroups({ includeInactive }, client);
    return sendResponse(res, 200, true, "Brand groups fetched", {
      total: rows.length,
      items: rows,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch groups", 500));
  } finally {
    client.release();
  }
});

module.exports.createGroup = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { name, rank, active, meta } = req.body;
    if (!name) return next(new AppError("name is required", 400));
    await client.query("BEGIN");
    const created = await BrandGroupService.createGroup(
      { name, rank, active, meta },
      client
    );
    await client.query("COMMIT");
    return sendResponse(res, 201, true, "Brand group created", created);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to create group", 500));
  } finally {
    client.release();
  }
});

module.exports.updateGroup = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id } = req.params;
    const updates = req.body || {};
    await client.query("BEGIN");
    const updated = await BrandGroupService.updateGroup(id, updates, client);
    if (!updated) {
      await client.query("ROLLBACK");
      return next(new AppError("Group not found or invalid payload", 404));
    }
    await client.query("COMMIT");
    return sendResponse(res, 200, true, "Brand group updated", updated);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to update group", 500));
  } finally {
    client.release();
  }
});

module.exports.deleteGroup = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    const removed = await BrandGroupService.deleteGroup(id, client);
    if (!removed) {
      await client.query("ROLLBACK");
      return next(new AppError("Group not found", 404));
    }
    await client.query("COMMIT");
    return sendResponse(res, 200, true, "Brand group deleted", removed);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to delete group", 500));
  } finally {
    client.release();
  }
});

module.exports.listGroupBrandsAdmin = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const groupId = req.query.group_id;
    if (!groupId) return next(new AppError("group_id is required", 400));
    const items = await BrandGroupService.listGroupBrands(groupId, client);
    return sendResponse(res, 200, true, "Group brands fetched", {
      total: items.length,
      items,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch group brands", 500));
  } finally {
    client.release();
  }
});

module.exports.addGroupBrand = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { group_id, brand_name, rank } = req.body;
    if (!group_id || !brand_name) {
      return next(new AppError("group_id and brand_name are required", 400));
    }
    await client.query("BEGIN");
    const exists = await client.query(
      `SELECT 1 FROM brand_group_brands
       WHERE group_id = $1 AND brand_name = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [group_id, brand_name]
    );
    if (exists.rowCount > 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Brand already in group", 400));
    }
    const created = await BrandGroupService.addGroupBrand(
      { group_id, brand_name, rank },
      client
    );
    await client.query("COMMIT");
    return sendResponse(res, 201, true, "Brand added to group", created);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to add brand", 500));
  } finally {
    client.release();
  }
});

module.exports.deleteGroupBrand = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    const removed = await BrandGroupService.deleteGroupBrand(id, client);
    if (!removed) {
      await client.query("ROLLBACK");
      return next(new AppError("Brand not found", 404));
    }
    await client.query("COMMIT");
    return sendResponse(res, 200, true, "Brand removed", removed);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(err.message || "Failed to remove brand", 500));
  } finally {
    client.release();
  }
});
