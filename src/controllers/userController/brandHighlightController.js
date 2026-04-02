const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const BrandHighlightService = require("../../services/brandHighlightService");

module.exports.getActiveBrandHighlights = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const items = await BrandHighlightService.listActivePublic(client);
    return sendResponse(res, 200, true, "Brand highlights fetched", {
      total: items.length,
      items,
    });
  } catch (err) {
    return next(
      new AppError(err.message || "Failed to fetch brand highlights", 500)
    );
  } finally {
    client.release();
  }
});
