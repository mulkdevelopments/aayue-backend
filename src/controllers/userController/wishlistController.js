const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");
const { WishlistService } = require("../../services/wishlistService");

module.exports.addToWishlist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const { product_id } = req.body;
    if (!isValidUUID(product_id))
      return next(new AppError("Invalid product id", 400));

    const wishlist = await WishlistService.addToWishlist(
      { user_id, product_id },
      client
    );

    return sendResponse(res, 200, true, "Added to wishlist", wishlist);
  } catch (err) {
    return next(new AppError(err.message, 500));
  } finally {
    client.release();
  }
});

module.exports.getWishlist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const wishlist = await WishlistService.getWishlist(user_id, client);

    return sendResponse(res, 200, true, "Wishlist fetched", wishlist);
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch wishlist", 500));
  } finally {
    client.release();
  }
});

module.exports.removeFromWishlist = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const { product_id } = req.query;
    if (!isValidUUID(product_id))
      return next(new AppError("Invalid product id", 400));

    const removed = await WishlistService.removeFromWishlist(
      user_id,
      product_id,
      client
    );

    return sendResponse(res, 200, true, "Removed from wishlist", removed);
  } catch (err) {
    return next(new AppError(err.message || "Failed to remove product", 500));
  } finally {
    client.release();
  }
});
