const { getLuxuryToken, getLuxuryProductById } = require("./luxuryHelper");
const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");

const LUXURY_VENDOR_ID = "65053474-4e40-44ee-941c-ef5253ea9fc9";

/**
 * Check real-time stock from Luxury Distribution API
 * Returns live stock data without updating database
 */
module.exports.checkLuxuryStock = catchAsync(async (req, res, next) => {
  const { productId } = req.query; // Our internal product ID
  const { vendorProductId } = req.query; // Vendor's product ID (supplier_product_id)

  if (!productId && !vendorProductId) {
    return next(new AppError("productId or vendorProductId is required", 400));
  }

  const client = await dbPool.connect();

  try {
    let supplierProductId = vendorProductId;

    // If only our productId is provided, fetch vendor_product_id from variants
    if (!supplierProductId && productId) {
      const result = await client.query(
        `SELECT DISTINCT vendor_product_id
         FROM product_variants
         WHERE product_id = $1 AND vendor_product_id IS NOT NULL
         LIMIT 1`,
        [productId]
      );

      if (result.rows.length === 0) {
        return next(new AppError("Product not found or not linked to Luxury Distribution", 404));
      }

      supplierProductId = result.rows[0].vendor_product_id;
    }

    // Verify product belongs to Luxury Distribution vendor
    const vendorCheck = await client.query(
      `SELECT p.id, p.name, pv.vendor_product_id
       FROM products p
       INNER JOIN product_variants pv ON p.id = pv.product_id
       INNER JOIN product_categories pc ON p.id = pc.product_id
       INNER JOIN categories c ON pc.category_id = c.id
       WHERE pv.vendor_product_id = $1
       AND c.vendor_id = $2
       LIMIT 1`,
      [supplierProductId, LUXURY_VENDOR_ID]
    );

    if (vendorCheck.rows.length === 0) {
      return next(new AppError("Product not found in Luxury Distribution vendor", 404));
    }

    console.log(`🔍 Checking live stock for product: ${supplierProductId}`);

    // Get authentication token
    const token = await getLuxuryToken();

    // Fetch product data from Luxury Distribution API
    const productData = await getLuxuryProductById(supplierProductId, token);

    if (!productData) {
      // Product deleted or not found - return 0 stock
      console.log("⚠️  Product not found in vendor system, returning 0 stock");
      return sendResponse(res, 200, true, "Product not found in vendor system", {
        supplierProductId,
        productName: null,
        brand: null,
        totalStock: 0,
        stockBySize: [],
        vendorPrice: {
          mrp: null,
          salePrice: null,
        },
        productDeleted: true,
        checkedAt: new Date().toISOString(),
      });
    }

    // Parse size_quantity array to get stock by size
    const sizeQuantities = Array.isArray(productData.size_quantity)
      ? productData.size_quantity
      : [];

    const stockBySizeArray = sizeQuantities.map(entry => {
      const sizeKey = Object.keys(entry || {})[0];
      const quantity = Number(entry[sizeKey] ?? 0) || 0;
      return {
        size: sizeKey || 'N/A',
        quantity: quantity,
      };
    });

    // Calculate total stock
    const totalStock = sizeQuantities.reduce((sum, entry) => {
      const sizeKey = Object.keys(entry || {})[0];
      const qty = Number(entry[sizeKey] ?? 0) || 0;
      return sum + qty;
    }, 0);

    console.log(`✅ Live stock fetched: ${totalStock} units total`);

    return sendResponse(res, 200, true, "Live stock data fetched successfully", {
      supplierProductId,
      productName: productData.name,
      brand: productData.brand,
      totalStock,
      stockBySize: stockBySizeArray,
      vendorPrice: {
        mrp: productData.original_price ? Number(productData.original_price) : null,
        salePrice: productData.selling_price ? Number(productData.selling_price) : null,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error checking live stock:", err.message);

    // Handle specific API errors
    if (err.response?.status === 404) {
      return next(new AppError("Product not found in vendor system", 404));
    }

    return next(new AppError(err.message || "Failed to check stock", 500));
  } finally {
    client.release();
  }
});
