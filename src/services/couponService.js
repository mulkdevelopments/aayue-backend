const dbPool = require("../db/dbConnection");
const AppError = require("../errorHandling/AppError");
const { randomUUID } = require("crypto");
const { isValidUUID } = require("../utils/basicValidation");

function toJsonOrNull(val, fieldName) {
  if (val === undefined || val === null) return null;

  // If it's already an object/array, stringify it (ensure valid JSON is sent to PG)
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch (e) {
      throw new AppError(`${fieldName} contains non-serializable value`, 400);
    }
  }

  // If it's a string, try to parse to ensure it's valid JSON, then re-stringify
  if (typeof val === "string") {
    const trimmed = val.trim();
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed);
    } catch (e) {
      // If it's not JSON (e.g. user sent "abc" or "['1']" with single quotes)
      // we will try a fallback: if it looks like a CSV of UUIDs like: 111,222 then convert to array
      // but best to fail explicitly so client fixes the payload:
      throw new AppError(
        `${fieldName} must be valid JSON (send actual array/object), got invalid JSON string`,
        400
      );
    }
  }

  // other primitive (number/boolean) - stringify to be safe
  return JSON.stringify(val);
}

function safeParse(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }
  return val;
}

/** Helper: compute sum of line totals for items list */
function sumItemsTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce(
    (s, it) => s + Number(it.unit_price || 0) * Number(it.qty || 0),
    0
  );
}

function ensureArrayOfUUIDs(arr, fieldName) {
  if (!Array.isArray(arr)) {
    throw new AppError(`${fieldName} must be an array of UUIDs`, 400);
  }
  for (const id of arr) {
    if (!isValidUUID(id))
      throw new AppError(`${fieldName} contains invalid UUID: ${id}`, 400);
  }
}

const CouponService = {
  async createCoupon(client, payload, createdBy) {
    // Basic required checks
    if (!payload.code || typeof payload.code !== "string") {
      throw new AppError("code is required and must be a string", 400);
    }
    payload.code = payload.code.trim().toUpperCase();

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

    // Date validation
    const startAt = new Date(payload.start_at);
    const endAt = new Date(payload.end_at);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new AppError("Invalid start_at or end_at", 400);
    }
    if (startAt.getTime() >= endAt.getTime()) {
      throw new AppError("start_at must be before end_at", 400);
    }

    // Type-specific validation
    if (payload.type === "PERCENT") {
      if (payload.value === undefined || payload.value === null) {
        throw new AppError("value is required for PERCENT coupons", 400);
      }
      const v = Number(payload.value);
      if (Number.isNaN(v) || v <= 0 || v > 100) {
        throw new AppError(
          "value for PERCENT must be a number between 0 and 100",
          400
        );
      }
      if (payload.max_discount !== undefined && payload.max_discount !== null) {
        const md = Number(payload.max_discount);
        if (Number.isNaN(md) || md < 0)
          throw new AppError("max_discount must be a non-negative number", 400);
      }
    } else if (payload.type === "FLAT") {
      if (payload.value === undefined || payload.value === null) {
        throw new AppError("value is required for FLAT coupons", 400);
      }
      const v = Number(payload.value);
      if (Number.isNaN(v) || v <= 0)
        throw new AppError("value for FLAT must be a positive number", 400);
    }

    // Parse/normalize JSON-able fields and validate UUID arrays if present
    const scopeIds = toJsonOrNull(payload.scope_ids, "scope_ids");
    const allowedUserIds = toJsonOrNull(
      payload.allowed_user_ids,
      "allowed_user_ids"
    );
    const excludedProductIds = toJsonOrNull(
      payload.excluded_product_ids,
      "excluded_product_ids"
    );
    const channels = toJsonOrNull(payload.channels || ["WEB"], "channels");

    // Validate arrays of UUIDs (if provided) - allow null/undefined
    if (scopeIds) ensureArrayOfUUIDs(scopeIds, "scope_ids");
    if (allowedUserIds) ensureArrayOfUUIDs(allowedUserIds, "allowed_user_ids");
    if (excludedProductIds)
      ensureArrayOfUUIDs(excludedProductIds, "excluded_product_ids");

    // createdBy validation
    if (!isValidUUID(createdBy))
      throw new AppError("createdBy is not a valid UUID", 400);

    // Ensure code uniqueness pre-check
    const codeCheck = await client.query(
      `SELECT id FROM coupons WHERE code = $1 LIMIT 1`,
      [payload.code]
    );
    if (codeCheck.rowCount > 0) {
      throw new AppError("Coupon code already exists", 409);
    }

    const sql = `
      INSERT INTO coupons (id, code, type, value, max_discount, currency, scope_type, scope_ids, min_subtotal, first_order_only,
        allowed_user_ids, excluded_product_ids, start_at, end_at, channels, usage_limit_total, usage_limit_per_user,
        stack_group, priority, status, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())
      RETURNING *
    `;

    const couponInsertValues = [
      randomUUID(), // id
      payload.code,
      payload.type,
      payload.value === undefined ? null : Number(payload.value),
      payload.max_discount === undefined ? null : Number(payload.max_discount),
      payload.currency || "INR",
      payload.scope_type,
      scopeIds, // pass object/array/null directly
      payload.min_subtotal === undefined ? 0 : Number(payload.min_subtotal),
      payload.first_order_only === true,
      allowedUserIds,
      excludedProductIds,
      startAt.toISOString(),
      endAt.toISOString(),
      channels,
      payload.usage_limit_total === undefined
        ? 0
        : Number(payload.usage_limit_total),
      payload.usage_limit_per_user === undefined
        ? 0
        : Number(payload.usage_limit_per_user),
      payload.stack_group || null,
      payload.priority === undefined ? 0 : Number(payload.priority),
      payload.status || "ACTIVE",
      createdBy,
    ];

    // DEBUG: helpful while testing
    // console.log("DEBUG couponInsertValues:");
    // couponInsertValues.forEach((v, i) => console.log(i+1, typeof v, v));

    try {
      const res = await client.query(sql, couponInsertValues);
      const row = res.rows[0];

      // PG might return JSONB columns as objects (ideal) or strings (depends on driver/config).
      // Safely parse only if PG returned strings.
      if (row.scope_ids && typeof row.scope_ids === "string") {
        try {
          row.scope_ids = JSON.parse(row.scope_ids);
        } catch (e) {
          /* ignore */
        }
      }
      if (row.allowed_user_ids && typeof row.allowed_user_ids === "string") {
        try {
          row.allowed_user_ids = JSON.parse(row.allowed_user_ids);
        } catch (e) {
          /* ignore */
        }
      }
      if (
        row.excluded_product_ids &&
        typeof row.excluded_product_ids === "string"
      ) {
        try {
          row.excluded_product_ids = JSON.parse(row.excluded_product_ids);
        } catch (e) {
          /* ignore */
        }
      }
      if (row.channels && typeof row.channels === "string") {
        try {
          row.channels = JSON.parse(row.channels);
        } catch (e) {
          /* ignore */
        }
      }

      return row;
    } catch (err) {
      console.error(
        "DB INSERT ERROR:",
        err.code,
        err.message,
        err.detail || ""
      );
      if (err.code === "23505") {
        throw new AppError(
          "Coupon code already exists (unique constraint)",
          409
        );
      }
      throw err;
    }
  },

  async getAllCoupons(client, { page, limit, q, sort, order, status }) {
    const offset = (page - 1) * limit;

    console.log("fetching coupons with params:", {
      page,
      limit,
      q,
      sort,
      order,
      status,
    });
    // allowlist for sortable columns to avoid SQL injection
    const sortable = new Set([
      "created_at",
      "code",
      "discount",
      "expires_at",
      "id",
    ]);
    const sortCol = sortable.has((sort || "").toLowerCase())
      ? sort
      : "created_at";
    const sortOrder = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";

    const params = [];
    let where = "";

    if (q && q.trim() !== "") {
      params.push(`%${q.trim()}%`);
      // If your column is coupon_code, change `code` -> `coupon_code`
      where = `WHERE c.code ILIKE $${params.length}`;
    }

    if (status && status.trim() !== "") {
      params.push(status.trim().toUpperCase());
      where += where
        ? ` AND c.status = $${params.length}`
        : `WHERE c.status = $${params.length}`;
    }

    // Total count for pagination (note: uses same where params)
    const countSql = `SELECT COUNT(*)::int AS count FROM coupons c ${where}`;
    const total = (await client.query(countSql, params)).rows[0].count;

    // Add pagination params
    params.push(limit); // LIMIT -> $n
    params.push(offset); // OFFSET -> $n+1

    const dataSql = `
    SELECT
      c.*,
      COALESCE(o.usage_count, 0) AS usage_count
    FROM coupons c
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS usage_count
      FROM orders o
      WHERE o.deleted_at IS NULL
      AND o.payment_status = 'paid'
        AND (o.coupon_id = c.id OR (o.coupon_code IS NOT NULL AND o.coupon_code = c.code))
    ) o ON true
    ${where}
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

    const { rows } = await client.query(dataSql, params);
    console.log("Fetched coupons:", rows.length);
    return { data: rows, total };
  },

  async verifyAndApplyCoupon(client, payload) {
    const code = String((payload.code || "").trim()).toUpperCase();
    // const channel = (payload.channel || "WEB").toUpperCase();
    const userId = payload.user_id || null;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const subtotal = Number(payload.subtotal || sumItemsTotal(items) || 0);
    console.log("Subtotal:", subtotal);
    const shippingCost = Number(payload.shipping_cost || 0);
    const now = new Date();

    // fetch coupon by code and active status/time window
    const q = `
    SELECT * FROM coupons
    WHERE code = $1
      AND status = 'ACTIVE'
      AND start_at <= NOW() AND end_at >= NOW()
    LIMIT 1
  `;
    const couponRes = await client.query(q, [code]);
    console.log("Coupon lookup result:", couponRes.rowCount);
    if (couponRes.rowCount === 0) {
      return {
        success: false,
        message: "Coupon not found or not active/valid",
        data: null,
      };
    }
    const coupon = couponRes.rows[0];
    console.log("Found coupon:", coupon);

    // parse jsonb fields safely
    const scope_ids = safeParse(coupon.scope_ids);
    const allowed_user_ids = safeParse(coupon.allowed_user_ids);
    const excluded_product_ids = safeParse(coupon.excluded_product_ids);
    const channels = safeParse(coupon.channels) || ["WEB"];

    // channel check
    // if (!channels.includes(channel)) {
    //   return {
    //     success: false,
    //     message: `Coupon not valid on channel ${channel}`,
    //     data: null,
    //   };
    // }

    // allowed users check
    if (Array.isArray(allowed_user_ids) && allowed_user_ids.length > 0) {
      if (!userId || !allowed_user_ids.includes(userId)) {
        return {
          success: false,
          message: "You are not eligible for this coupon",
          data: null,
        };
      }
    }
    console.log("User eligibility check passed");

    // excluded products check
    if (
      Array.isArray(excluded_product_ids) &&
      excluded_product_ids.length > 0
    ) {
      for (const it of items) {
        if (excluded_product_ids.includes(it.product_id)) {
          return {
            success: false,
            message:
              "Coupon cannot be applied because cart contains excluded product(s)",
            data: null,
          };
        }
      }
    }

    console.log("Excluded products check passed");
    // min_subtotal check

    console.log(subtotal, "subtotal vs min", Number(coupon.min_subtotal || 0));
    if (Number(coupon.min_subtotal || 0) > subtotal) {
      return {
        success: false,
        message: `Cart subtotal must be at least ${coupon.min_subtotal}`,
        data: null,
      };
    }

    console.log("Minimum subtotal check passed");
    // first_order_only check
    // if (coupon.first_order_only === true && userId) {
    //   // crude check - presence of any prior paid orders for user
    //   const usedRes = await client.query(
    //     `SELECT COUNT(*)::int as cnt FROM orders WHERE user_id = $1 AND payment_status = 'paid'`,
    //     [userId]
    //   );
    //   console.log(
    //     "First order only - prior paid orders count:",
    //     usedRes.rows[0]
    //   );
    //   console.log(usedRes.rows[0]);
    //   const userPaidOrders = (usedRes.rows[0] && usedRes.rows[0].cnt) || 0;
    //   if (userPaidOrders > 0) {
    //     return {
    //       success: false,
    //       message: "Coupon valid only on first order",
    //       data: null,
    //     };
    //   }
    // }

    console.log("First order only check passed");

    // usage limits: total & per-user
    // treat 0 as unlimited
    if (coupon.usage_limit_total && Number(coupon.usage_limit_total) > 0) {
      const totalUsedRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM orders WHERE coupon_code = $1 AND payment_status = 'paid'`,
        [coupon.code]
      );
      const totalUsed = (totalUsedRes.rows[0] && totalUsedRes.rows[0].cnt) || 0;
      if (totalUsed >= Number(coupon.usage_limit_total)) {
        return {
          success: false,
          message: "Coupon usage limit reached",
          data: null,
        };
      }
    }
    // if (
    //   userId &&
    //   coupon.usage_limit_per_user &&
    //   Number(coupon.usage_limit_per_user) > 0
    // ) {
    //   const userUsedRes = await client.query(
    //     `SELECT COUNT(*)::int as cnt FROM orders WHERE coupon_code = $1 AND user_id = $2 AND payment_status = 'paid'`,
    //     [coupon.code, userId]
    //   );
    //   const userUsed = (userUsedRes.rows[0] && userUsedRes.rows[0].cnt) || 0;
    //   if (userUsed >= Number(coupon.usage_limit_per_user)) {
    //     return {
    //       success: false,
    //       message:
    //         "You have already used this coupon the maximum allowed times",
    //       data: null,
    //     };
    //   }
    // }

    // Determine applicable amount based on scope
    let applicableAmount = 0;
    if (coupon.scope_type === "GLOBAL") {
      console.log("Coupon scope is GLOBAL");
      applicableAmount = subtotal;
    } else if (coupon.scope_type === "CART") {
      // treat CART same as GLOBAL for now
      applicableAmount = subtotal;
    } else if (coupon.scope_type === "PRODUCT") {
      if (!Array.isArray(scope_ids) || scope_ids.length === 0) {
        // nothing in scope => not applicable
        return {
          success: false,
          message: "Coupon has no applicable products",
          data: null,
        };
      }
      // sum only items whose product_id in scope_ids
      applicableAmount = items.reduce((s, it) => {
        if (scope_ids.includes(it.product_id))
          return s + Number(it.unit_price || 0) * Number(it.qty || 0);
        return s;
      }, 0);
      if (applicableAmount <= 0) {
        return {
          success: false,
          message: "No cart items eligible for this coupon",
          data: null,
        };
      }
    } else if (coupon.scope_type === "CATEGORY") {
      if (!Array.isArray(scope_ids) || scope_ids.length === 0) {
        return {
          success: false,
          message: "Coupon has no applicable categories",
          data: null,
        };
      }
      applicableAmount = items.reduce((s, it) => {
        if (scope_ids.includes(it.category_id))
          return s + Number(it.unit_price || 0) * Number(it.qty || 0);
        return s;
      }, 0);
      if (applicableAmount <= 0) {
        return {
          success: false,
          message: "No cart items in eligible categories",
          data: null,
        };
      }
    } else {
      // fallback
      applicableAmount = subtotal;
    }

    // Compute discount based on type
    let discount = 0;
    let freeShipping = false;
    let bogo_details = null;

    if (coupon.type === "PERCENT") {
      console.log("Calculating PERCENT discount");
      const percent = Number(coupon.value || 0);
      discount = (applicableAmount * percent) / 100;
      if (coupon.max_discount !== null && coupon.max_discount !== undefined) {
        const maxD = Number(coupon.max_discount);
        if (!Number.isNaN(maxD) && maxD > 0 && discount > maxD) discount = maxD;
      }
    } else if (coupon.type === "FLAT") {
      const flat = Number(coupon.value || 0);
      discount = Math.min(flat, applicableAmount); // can't exceed applicable amount
    } else if (coupon.type === "FREE_SHIP") {
      freeShipping = true;
      discount = Number(shippingCost || 0); // we treat free shipping as discount of shipping cost
    } else if (coupon.type === "BOGO") {
      // Simple BOGO: for items in scope, for every 2 units, 1 unit free (cheapest applicable unit price)
      // Build list of eligible unit prices expanded by qty
      const eligibleUnits = [];
      for (const it of items) {
        const inScope =
          coupon.scope_type === "GLOBAL" ||
          (coupon.scope_type === "PRODUCT" &&
            Array.isArray(scope_ids) &&
            scope_ids.includes(it.product_id)) ||
          (coupon.scope_type === "CATEGORY" &&
            Array.isArray(scope_ids) &&
            scope_ids.includes(it.category_id));
        if (!inScope) continue;
        const qty = Number(it.qty || 0);
        for (let i = 0; i < qty; i++)
          eligibleUnits.push(Number(it.unit_price || 0));
      }
      eligibleUnits.sort((a, b) => a - b); // cheapest first
      const freeCount = Math.floor(eligibleUnits.length / 2);
      discount = eligibleUnits.slice(0, freeCount).reduce((s, p) => s + p, 0);
      bogo_details = {
        free_items: freeCount,
        free_unit_prices: eligibleUnits.slice(0, freeCount),
      };
    }

    // final calculations
    const finalSubtotal = Math.max(0, subtotal - discount);
    const finalShipping = freeShipping ? 0 : shippingCost;
    const finalTotal = Math.max(0, finalSubtotal + finalShipping);

    const responseData = {
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        scope_type: coupon.scope_type,
      },
      discount: Number(discount.toFixed(2)),
      free_shipping: Boolean(freeShipping),
      bogo: bogo_details,
      subtotal: Number(subtotal.toFixed(2)),
      shipping_cost: Number(shippingCost.toFixed(2)),
      final_total: Number(finalTotal.toFixed(2)),
      applied_on_amount: Number(applicableAmount.toFixed(2)),
    };

    console.log("Coupon applied successfully:", responseData);

    return { success: true, message: "Coupon applied", data: responseData };
  },
  async activeDeactiveCoupon(client, newStatus, couponId) {
    console.log("Update coupon status:", newStatus);
    // ✅ Validate newStatus
    const allowedStatuses = ["ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"];
    console.log("Allowed statuses:", allowedStatuses);
    if (!allowedStatuses.includes(newStatus)) {
      throw new AppError("Invalid status value", 400);
    }

    try {
      // ✅ Update status
      const couponRes = await client.query(
        `UPDATE coupons 
       SET status = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
        [newStatus, couponId]
      );

      if (couponRes.rowCount === 0) {
        throw new AppError("Coupon not found", 404);
      }

      // ✅ Return updated coupon data
      return {
        success: true,
        data: couponRes.rows[0],
      };
    } catch (err) {
      console.error(
        "DB UPDATE ERROR:",
        err.code,
        err.message,
        err.detail || ""
      );
      throw new AppError("Failed to update coupon status", 500);
    }
  },

  async deleteCoupon(client, couponId) {
    try {
      const couponRes = await client.query(
        `DELETE FROM coupons WHERE id = $1 RETURNING *`,
        [couponId]
      );
      if (couponRes.rowCount === 0) {
        throw new AppError("Coupon not found", 404);
      }
      return {
        success: true,
        message: "Coupon deleted successfully",
      };
    } catch (err) {
      console.error(
        "DB DELETE ERROR:",
        err.code,
        err.message,
        err.detail || ""
      );
      throw new AppError("Failed to delete coupon", 500);
    }
  },
};

module.exports = { CouponService };
