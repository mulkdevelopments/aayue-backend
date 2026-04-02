const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const { getPeppelaLiveStockData } = require("./PeppelaApiService");

const PEPPELA_VENDOR_ID = "b34fd0f6-815a-469e-b7c2-73f9e8afb3ed";

/**
 * Check real-time stock from Peppela API
 */
module.exports.checkPeppelaStock = catchAsync(async (req, res, next) => {
  const { productId, vendorProductId } = req.query;

  if (!productId && !vendorProductId) {
    return next(new AppError("productId or vendorProductId is required", 400));
  }

  const client = await dbPool.connect();
  try {
    let peppelaProductId = vendorProductId;

    if (!peppelaProductId && productId) {
      const result = await client.query(
        `SELECT productid, vendor_id
         FROM products
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [productId]
      );

      if (result.rows.length === 0) {
        return next(new AppError("Product not found", 404));
      }

      if (result.rows[0].vendor_id !== PEPPELA_VENDOR_ID) {
        return next(new AppError("Product is not linked to Peppela", 404));
      }

      peppelaProductId = result.rows[0].productid;
    }

    if (!peppelaProductId) {
      return next(new AppError("Vendor product id not found", 404));
    }

    const liveStock = await getPeppelaLiveStockData(peppelaProductId);
    return sendResponse(res, 200, true, "Live stock data fetched successfully", liveStock);
  } catch (err) {
    return next(new AppError(err.message || "Failed to check stock", 500));
  } finally {
    client.release();
  }
});
