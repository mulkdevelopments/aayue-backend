const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const BrandHighlightService = require("../../services/brandHighlightService");
const {
  destroyCloudinaryAssetByUrl,
} = require("../../utils/cloudinaryDestroyByUrl");

module.exports.listBrandHighlightsAdmin = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const includeInactive =
      String(req.query.include_inactive || "true") === "true";
    const items = await BrandHighlightService.listAdmin(
      { includeInactive },
      client
    );
    return sendResponse(res, 200, true, "Brand highlights fetched", {
      total: items.length,
      items,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch brand highlights", 500));
  } finally {
    client.release();
  }
});

module.exports.createBrandHighlight = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { brand_name, display_label, image_url, link_url, sort_order, active } =
      req.body || {};
    if (!brand_name || !image_url) {
      return next(new AppError("brand_name and image_url are required", 400));
    }
    await client.query("BEGIN");
    const created = await BrandHighlightService.create(
      {
        brand_name,
        display_label,
        image_url,
        link_url,
        sort_order,
        active,
      },
      client
    );
    await client.query("COMMIT");
    return sendResponse(res, 201, true, "Brand highlight created", created);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      return next(
        new AppError("A highlight for this brand already exists", 400)
      );
    }
    return next(
      new AppError(err.message || "Failed to create brand highlight", 500)
    );
  } finally {
    client.release();
  }
});

module.exports.updateBrandHighlight = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id } = req.params;
    const body = req.body || {};
    await client.query("BEGIN");
    const existing = await BrandHighlightService.getById(id, client);
    if (!existing) {
      await client.query("ROLLBACK");
      return next(new AppError("Highlight not found", 404));
    }
    const updated = await BrandHighlightService.update(id, body, client);
    await client.query("COMMIT");
    if (
      body.image_url &&
      existing.image_url &&
      existing.image_url !== body.image_url
    ) {
      try {
        await destroyCloudinaryAssetByUrl(existing.image_url);
      } catch (e) {
        console.warn("Cloudinary cleanup after highlight image change:", e.message);
      }
    }
    return sendResponse(res, 200, true, "Brand highlight updated", updated);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      return next(
        new AppError("A highlight for this brand already exists", 400)
      );
    }
    return next(
      new AppError(err.message || "Failed to update brand highlight", 500)
    );
  } finally {
    client.release();
  }
});

module.exports.deleteBrandHighlight = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    const removed = await BrandHighlightService.softDelete(id, client);
    if (!removed) {
      await client.query("ROLLBACK");
      return next(new AppError("Highlight not found", 404));
    }
    await client.query("COMMIT");
    try {
      await destroyCloudinaryAssetByUrl(removed.image_url);
    } catch (e) {
      console.warn("Cloudinary cleanup after highlight delete:", e.message);
    }
    return sendResponse(res, 200, true, "Brand highlight removed", { id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(
      new AppError(err.message || "Failed to delete brand highlight", 500)
    );
  } finally {
    client.release();
  }
});
