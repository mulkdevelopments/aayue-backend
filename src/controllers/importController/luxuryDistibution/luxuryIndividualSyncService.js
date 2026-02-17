const { getLuxuryToken, getLuxuryProductById } = require("./luxuryHelper");
const { transformRowToProduct } = require("./luxuryImportHelper");
const { upsertProductAndVariant } = require("./luxuryImportService");
const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");

const LUXURY_VENDOR_ID = "65053474-4e40-44ee-941c-ef5253ea9fc9";

/**
 * Sync individual product from Luxury Distribution
 * This function fetches a single product by its vendor_product_id and syncs it
 */
module.exports.syncIndividualLuxuryProduct = catchAsync(async (req, res, next) => {
  const { productId } = req.body; // Our internal product ID
  const { vendorProductId } = req.body; // Vendor's product ID (supplier_product_id)

  if (!productId && !vendorProductId) {
    return next(new AppError("productId or vendorProductId is required", 400));
  }

  const client = await dbPool.connect();

  try {
    let supplierProductId = vendorProductId;

    // If only our productId is provided, fetch productid (vendor's product ID) from products table
    if (!supplierProductId && productId) {
      const result = await client.query(
        `SELECT productid
         FROM products
         WHERE id = $1 AND productid IS NOT NULL AND deleted_at IS NULL
         LIMIT 1`,
        [productId]
      );

      if (result.rows.length === 0) {
        return next(new AppError("Product not found or not linked to Luxury Distribution", 404));
      }

      supplierProductId = result.rows[0].productid;
    }

    // Verify product belongs to Luxury Distribution vendor (using products table, not variants)
    const vendorCheck = await client.query(
      `SELECT p.id, p.name, p.productid
       FROM products p
       WHERE p.productid = $1
       AND p.vendor_id = $2
       AND p.deleted_at IS NULL
       LIMIT 1`,
      [supplierProductId, LUXURY_VENDOR_ID]
    );

    // If product doesn't exist yet, that's OK - we'll create it during sync
    if (vendorCheck.rows.length === 0) {
      console.log(`ℹ️ Product not found in DB, will be created during sync`);
    }

    console.log(`🔄 Syncing individual product: ${supplierProductId}`);

    // Get authentication token
    const token = await getLuxuryToken();

    // Fetch product data from Luxury Distribution API
    const productData = await getLuxuryProductById(supplierProductId, token);

    if (!productData) {
      return next(new AppError("Product not found in Luxury Distribution API", 404));
    }

    console.log(`✅ Fetched product data from LD: ${productData.name}`);

    // Transform product data to our format
    const transformed = transformRowToProduct(productData);
    if (!transformed) {
      return sendResponse(res, 200, true, "Product skipped (price below 6)", {
        productId: productId || null,
        vendorProductId: supplierProductId,
        skipped: true,
      });
    }
    if (require("../excludedBrands").isBrandExcluded(transformed.product?.brand_name)) {
      return sendResponse(res, 200, true, "Product skipped (excluded brand)", {
        productId: productId || null,
        vendorProductId: supplierProductId,
        skipped: true,
      });
    }
    const { product, variants } = transformed;

    // Sync the product using existing sync logic
    const syncResult = await upsertProductAndVariant(client, transformed);

    console.log(`✅ Product synced successfully: ${product.name}`);

    return sendResponse(res, 200, true, "Product synced successfully", {
      productId: syncResult.productId,
      productSku: product.product_sku,
      productName: product.name,
      variantsCount: variants.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error syncing individual product:", err.message);
    return next(new AppError(err.message || "Failed to sync product", 500));
  } finally {
    client.release();
  }
});
