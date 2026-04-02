const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const {
  fetchProductById,
} = require("./peppelaHelper");
const {
  transformPeppelaProduct,
  upsertProductAndVariants,
} = require("./PeppelaApiService");

const PEPPELA_VENDOR_ID = "b34fd0f6-815a-469e-b7c2-73f9e8afb3ed";

/**
 * Sync individual product from Peppela (PrestaShop)
 * Accepts internal productId or vendorProductId (PrestaShop product id)
 */
module.exports.syncIndividualPeppelaProduct = catchAsync(async (req, res, next) => {
  const { productId, vendorProductId } = req.body;

  if (!productId && !vendorProductId) {
    return next(new AppError("productId or vendorProductId is required", 400));
  }

  const client = await dbPool.connect();
  try {
    console.log("🔎 Peppela individual sync request", {
      productId,
      vendorProductId,
    });
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

    console.log("🧾 Fetching Peppela product from API", { peppelaProductId });
    const productData = await fetchProductById(peppelaProductId);
    if (!productData) {
      return next(new AppError("Product not found in Peppela API", 404));
    }

    console.log("🧩 Transforming Peppela product", {
      peppelaProductId,
      sku: productData.reference || null,
    });
    const transformed = await transformPeppelaProduct(productData);
    if (!transformed) {
      return sendResponse(res, 200, true, "Product skipped (price below 6)", {
        productId: productId || null,
        vendorProductId: peppelaProductId,
        skipped: true,
      });
    }
    if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) {
      return sendResponse(res, 200, true, "Product skipped (excluded brand)", {
        productId: productId || null,
        vendorProductId: peppelaProductId,
        skipped: true,
      });
    }
    if (require("../kidsProductFilter").isKidsProduct(transformed.product)) {
      return sendResponse(res, 200, true, "Product skipped (kids product not imported)", {
        productId: productId || null,
        vendorProductId: peppelaProductId,
        skipped: true,
      });
    }
    console.log("💾 Upserting Peppela product", {
      peppelaProductId,
      productSku: transformed.product.product_sku,
      variants: transformed.variants.length,
      gender: transformed.product.gender || null,
      country_of_origin: transformed.product.country_of_origin || null,
      category_path: transformed.category_path || null,
    });
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
});
