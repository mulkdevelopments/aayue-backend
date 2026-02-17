const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const BrandGroupService = require("../../services/brandGroupService");

module.exports.getActiveBrandGroups = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { category_slug } = req.query;
    const items = await BrandGroupService.listActiveGroupsWithBrands(client, {
      categorySlug: category_slug,
    });
    return sendResponse(res, 200, true, "Brand groups fetched", {
      total: items.length,
      items,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch brand groups", 500));
  } finally {
    client.release();
  }
});
