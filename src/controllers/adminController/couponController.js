const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const { isValidUUID } = require("../../utils/basicValidation");
const dbPool = require("../../db/dbConnection");
const { CouponService } = require("../../services/couponService");
const jwt = require("jsonwebtoken");
const { UserServices } = require("../../services/userServices");

const createCoupon = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    // Basic ownership: prefer req.user.id, fallback to created_by in body
    const createdBy = (req.user && req.user.id) || req.body.created_by;
    if (!createdBy || !isValidUUID(createdBy)) {
      throw new AppError("created_by (user id) missing or invalid UUID", 400);
    }

    // Pull payload
    const payload = { ...req.body };

    // Normalize code to uppercase
    if (!payload.code || typeof payload.code !== "string") {
      throw new AppError("code is required and must be a string", 400);
    }
    payload.code = payload.code.trim().toUpperCase();

    // required fields validation
    if (
      !payload.type ||
      !["PERCENT", "FLAT", "FREE_SHIP", "BOGO"].includes(payload.type)
    ) {
      throw new AppError(
        "type missing or invalid. Allowed: PERCENT, FLAT, FREE_SHIP, BOGO",
        400
      );
    }
    if (
      !payload.scope_type ||
      !["GLOBAL", "PRODUCT", "CATEGORY", "CART"].includes(payload.scope_type)
    ) {
      throw new AppError(
        "scope_type missing or invalid. Allowed: GLOBAL, PRODUCT, CATEGORY, CART",
        400
      );
    }
    if (!payload.start_at || !payload.end_at) {
      throw new AppError("start_at and end_at are required", 400);
    }

    // Start transaction
    await client.query("BEGIN");

    // Delegate to service
    const createdCoupon = await CouponService.createCoupon(
      client,
      payload,
      createdBy
    );

    await client.query("COMMIT");

    return sendResponse(res, 201, true, "Coupon created", createdCoupon);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

// GET /coupons?page=1&limit=20&q=SAVE&sort=created_at&order=desc
const getAllCoupons = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      page = 1,
      limit = 20,
      q = "", // search text for coupon code
      sort = "created_at",
      order = "desc",
      status, // filter by status
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100); // hard cap

    const { data, total } = await CouponService.getAllCoupons(client, {
      page: pageNum,
      limit: limitNum,
      q: String(q),
      sort: String(sort),
      order: String(order),
      status: status ? String(status) : undefined,
    });

    return sendResponse(res, 200, true, "Coupons fetched", {
      items: data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
        hasPrev: pageNum > 1,
      },
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

const applyCoupon = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  let user_id = null;

  // 1. TOKEN OPTIONAL — AGAR HAI TO USER FETCH KAR
  if (req.headers.authorization?.startsWith("Bearer")) {
    const token = req.headers.authorization.split(" ")[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.userId && isValidUUID(decoded.userId)) {
        const user = await UserServices.findUserById(decoded.userId);
        if (user) {
          req.user = user;
          user_id = user.id;
        }
      }
    } catch (err) {
      console.log("Invalid token, proceeding as guest:", err.message);
      // Ignore — proceed as guest
    }
  }
  try {
    const payload = req.body || {};
    const { code } = payload;
    payload.user_id = user_id;

    if (!code || typeof code !== "string") {
      throw new AppError("coupon code is required", 400);
    }

    // optional user validation
    if (user_id && !isValidUUID(user_id)) {
      throw new AppError("user_id must be a valid UUID", 400);
    }

    const result = await CouponService.verifyAndApplyCoupon(client, payload);
    return sendResponse(
      res,
      result.success ? 200 : 400,
      result.success,
      result.message,
      result.data,
      result.error || null
    );
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

const activeDeactiveCoupon = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { id, status } = req.body;
    const result = await CouponService.activeDeactiveCoupon(client, status, id);
    return sendResponse(
      res,
      result.success ? 200 : 400,
      result.success,
      result.message,
      result.data,
      result.error || null
    );
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

const deleteCoupon = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { coupon_id } = req.query;
    const result = await CouponService.deleteCoupon(client, coupon_id);
    return sendResponse(
      res,
      result.success ? 200 : 400,
      result.success,
      result.message,
      result.data,
      result.error || null
    );
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports = {
  createCoupon,
  getAllCoupons,
  applyCoupon,
  activeDeactiveCoupon,
  deleteCoupon,
};
