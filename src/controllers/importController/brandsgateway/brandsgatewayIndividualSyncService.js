const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const { fetchProductById } = require("./brandsgatewayHelper");
const {
  transformBrandsgatewayProduct,
  upsertProductAndVariants,
} = require("./BrandsgatewayApiService");

const BRANDS_GATEWAY_VENDOR_ID = "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c";
const STORE_ID = Number(process.env.BRANDSGATEWAY_STORE_ID || 0) || 0;

module.exports.syncIndividualBrandsgatewayProduct = catchAsync(
  async (req, res, next) => {
    const { productId, vendorProductId } = req.body;

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

      const productData = await fetchProductById(bgProductId, STORE_ID);
      if (!productData) {
        return next(new AppError("Product not found in Brandsgateway API", 404));
      }

      const transformed = await transformBrandsgatewayProduct(productData);
      if (!transformed) {
        return sendResponse(res, 200, true, "Product skipped (price below 6)", {
          productId: productId || null,
          vendorProductId: bgProductId,
          skipped: true,
        });
      }
      if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) {
        return sendResponse(res, 200, true, "Product skipped (excluded brand)", {
          productId: productId || null,
          vendorProductId: bgProductId,
          skipped: true,
        });
      }

      const syncResult = await upsertProductAndVariants(client, transformed);

      return sendResponse(res, 200, true, "Product synced successfully", {
        productId: syncResult.productId,
        productSku: transformed.product.product_sku,
        productName: transformed.product.name,
        variantsCount: transformed.variants.length,
        syncedAt: new Date().toISOString(),
      });
    } catch (err) {
      return next(new AppError(err.message || "Failed to sync product", 500));
    } finally {
      client.release();
    }
  }
);
