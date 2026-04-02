const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const { getBrandsgatewayLiveStockData } = require("./BrandsgatewayApiService");

const BRANDS_GATEWAY_VENDOR_ID = "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c";

module.exports.checkBrandsgatewayStock = catchAsync(async (req, res, next) => {
  const { productId, vendorProductId } = req.query || {};

  if (!productId && !vendorProductId) {
    return next(new AppError("productId or vendorProductId is required", 400));
  }

  const client = await dbPool.connect();
  try {
    let bgProductId = vendorProductId;

    if (!bgProductId && productId) {
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

      if (result.rows[0].vendor_id !== BRANDS_GATEWAY_VENDOR_ID) {
        return next(new AppError("Product is not linked to Brandsgateway", 404));
      }

      bgProductId = result.rows[0].productid;
    }

    if (!bgProductId) {
      return next(new AppError("Vendor product id not found", 404));
    }

    const stockData = await getBrandsgatewayLiveStockData(bgProductId);
    if (!stockData) {
      return next(new AppError("Stock data not found", 404));
    }

    return sendResponse(res, 200, true, "Live stock fetched successfully", stockData);
  } catch (err) {
    return next(new AppError(err.message || "Failed to check live stock", 500));
  } finally {
    client.release();
  }
});
