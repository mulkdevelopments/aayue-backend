const dbPool = require("../../db/dbConnection");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");
const { getAICategorySuggestions } = require("../../services/aiCategorySuggestionService");
const ProductService = require("../../services/productService");
const CategoryService = require("../../services/categoryService");

/**
 * Get AI-powered category suggestions for a product
 * POST /admin/ai-category-suggestions
 * Body: { productId: string }
 */
module.exports.getAICategorySuggestions = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { productId } = req.body;

    if (!productId || !isValidUUID(productId)) {
      return next(new AppError("Valid productId is required", 400));
    }

    // Fetch product details
    const product = await ProductService.getProductByIdAdmin(productId, client);
    if (!product) {
      return next(new AppError("Product not found", 404));
    }

    // Fetch our categories (the ones we want to map to)
    const categories = await CategoryService.getAllOurCategories(client);
    if (!categories || categories.length === 0) {
      return next(new AppError("No categories available for mapping", 404));
    }

    // Get AI suggestions
    const suggestions = await getAICategorySuggestions(product, categories);

    return sendResponse(res, 200, true, "AI suggestions generated successfully", {
      product_id: productId,
      product_name: product.name,
      suggestions: suggestions,
    });
  } catch (err) {
    console.error("AI Suggestion Error:", err);
    return next(new AppError(err.message || "Failed to generate AI suggestions", 500));
  } finally {
    client.release();
  }
});
