const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");
const { ProductReviewService } = require("../../services/productReviewService");

module.exports.addReview = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return next(new AppError("Unauthorized", 401));

    const { productId, reviewText, rating, images } = req.body;
    if (!isValidUUID(productId))
      return next(new AppError("Invalid product id", 400));

    const review = await ProductReviewService.addReview(
      { userId, productId, reviewText, rating, images },
      client
    );

    return sendResponse(res, 200, true, "Review added", review);
  } catch (err) {
    return next(new AppError(err.message, 500));
  } finally {
    client.release();
  }
});

module.exports.getReviews = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const productId = req.query.productId;
    if (!productId)
      return res.status(400).json({ message: "product_id is required" });

    const {
      page = 1,
      limit = 10,
      rating,
      with_images,
      verified,
      sort = "newest",
    } = req.query;

    const data = await ProductReviewService.getProductReviews(
      {
        productId,
        page,
        limit,
        rating,
        with_images,
        verified,
        sort,
      },
      client
    );

    return sendResponse(res, 200, true, "Reviews fetched", data);
  } catch (err) {
    console.error("getReviews error:", err);
    return next(err);
  } finally {
    client.release();
  }
});
