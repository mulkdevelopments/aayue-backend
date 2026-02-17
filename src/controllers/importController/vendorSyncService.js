const dbPool = require("../../db/dbConnection");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");

const { syncIndividualLuxuryProduct } = require("./luxuryDistibution/luxuryIndividualSyncService");
const { checkLuxuryStock } = require("./luxuryDistibution/luxuryStockCheckService");
const { syncIndividualPeppelaProduct } = require("./peppela/peppelaIndividualSyncService");
const { checkPeppelaStock } = require("./peppela/peppelaStockCheckService");
const { syncIndividualBrandsgatewayProduct } = require("./brandsgateway/brandsgatewayIndividualSyncService");
const { checkBrandsgatewayStock } = require("./brandsgateway/brandsgatewayStockCheckService");

const LUXURY_VENDOR_ID = "65053474-4e40-44ee-941c-ef5253ea9fc9";
const PEPPELA_VENDOR_ID = "b34fd0f6-815a-469e-b7c2-73f9e8afb3ed";
const BRANDSGATEWAY_VENDOR_ID = "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c";

async function resolveVendorIdByProductId(productId) {
  const client = await dbPool.connect();
  try {
    const result = await client.query(
      `SELECT vendor_id FROM products WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [productId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].vendor_id;
  } finally {
    client.release();
  }
}

module.exports.syncIndividualProduct = catchAsync(async (req, res, next) => {
  const { productId, vendorProductId, vendorId } = req.body || {};
  let resolvedVendorId = vendorId;

  if (!resolvedVendorId && productId) {
    resolvedVendorId = await resolveVendorIdByProductId(productId);
  }

  console.log("🔁 Sync individual product (router)", {
    productId,
    vendorProductId,
    vendorId,
    resolvedVendorId,
  });

  if (!resolvedVendorId) {
    return next(new AppError("Unable to resolve vendor for this product", 404));
  }

  if (resolvedVendorId === LUXURY_VENDOR_ID) {
    return syncIndividualLuxuryProduct(req, res, next);
  }

  if (resolvedVendorId === PEPPELA_VENDOR_ID) {
    return syncIndividualPeppelaProduct(req, res, next);
  }

  if (resolvedVendorId === BRANDSGATEWAY_VENDOR_ID) {
    return syncIndividualBrandsgatewayProduct(req, res, next);
  }

  return next(new AppError("Vendor not supported for individual sync", 400));
});

module.exports.checkLiveStock = catchAsync(async (req, res, next) => {
  const { productId, vendorProductId, vendorId } = req.query || {};
  let resolvedVendorId = vendorId;

  if (!resolvedVendorId && productId) {
    resolvedVendorId = await resolveVendorIdByProductId(productId);
  }

  console.log("📦 Live stock check (router)", {
    productId,
    vendorProductId,
    vendorId,
    resolvedVendorId,
  });

  if (!resolvedVendorId) {
    return next(new AppError("Unable to resolve vendor for this product", 404));
  }

  if (resolvedVendorId === LUXURY_VENDOR_ID) {
    return checkLuxuryStock(req, res, next);
  }

  if (resolvedVendorId === PEPPELA_VENDOR_ID) {
    return checkPeppelaStock(req, res, next);
  }

  if (resolvedVendorId === BRANDSGATEWAY_VENDOR_ID) {
    return checkBrandsgatewayStock(req, res, next);
  }

  return next(new AppError("Vendor not supported for stock check", 400));
});
