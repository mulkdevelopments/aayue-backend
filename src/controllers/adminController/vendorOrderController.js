/**
 * Admin Vendor Order Controller
 *
 * Endpoints for managing vendor order placement
 */

const dbPool = require('../../db/dbConnection');
const catchAsync = require('../../errorHandling/catchAsync');
const sendResponse = require('../../utils/sendResponse');
const { VendorOrderManager } = require('../../services/vendorOrders');
const { fetchCarrierTimeline } = require('../../services/carrierTracking17Service');

/**
 * Get vendor orders summary
 * GET /admin/vendor-orders/summary
 */
exports.getVendorOrdersSummary = catchAsync(async (req, res, next) => {
  const { limit = 50, offset = 0, status } = req.query;

  let whereClause = `WHERE o.deleted_at IS NULL AND oi.deleted_at IS NULL`;

  if (status) {
    whereClause += ` AND oi.vendor_order_status = '${status}'`;
  }

  const { rows } = await dbPool.query(`
    SELECT
      o.id AS order_id,
      o.order_no,
      o.created_at AS order_date,
      o.payment_status,
      u.email AS customer_email,
      u.full_name AS customer_name,
      v.id AS vendor_id,
      v.name AS vendor_name,
      v.integration_type,
      COUNT(oi.id) AS total_items,
      SUM(oi.qty) AS total_qty,
      SUM(oi.price * oi.qty) AS total_amount,
      COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'placed') AS items_placed,
      COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'failed') AS items_failed,
      COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'pending') AS items_pending,
      MAX(oi.vendor_order_id) AS vendor_order_id,
      MAX(oi.vendor_reference_number) AS vendor_reference,
      CASE
        WHEN COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'placed') = COUNT(oi.id) THEN 'fully_placed'
        WHEN COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'failed') > 0 THEN 'failed'
        ELSE 'pending'
      END AS placement_status
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN vendors v ON v.id = oi.vendor_id
    ${whereClause}
    GROUP BY o.id, o.order_no, o.created_at, o.payment_status, u.email, u.full_name, v.id, v.name, v.integration_type
    ORDER BY o.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  sendResponse(res, 200, {
    orders: rows,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: rows.length
    }
  });
});

/**
 * Get failed vendor orders
 * GET /admin/vendor-orders/failed
 */
exports.getFailedVendorOrders = catchAsync(async (req, res, next) => {
  const { rows } = await dbPool.query(`
    SELECT DISTINCT
      o.id AS order_id,
      o.order_no,
      o.created_at AS order_date,
      v.name AS vendor_name,
      v.id AS vendor_id,
      v.integration_type,
      COUNT(oi.id) AS failed_items,
      u.email AS customer_email,
      u.full_name AS customer_name,
      o.total_amount,
      o.shipping_address->>'city' AS shipping_city,
      o.shipping_address->>'country' AS shipping_country
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE oi.vendor_order_status = 'failed'
      AND oi.deleted_at IS NULL
      AND o.deleted_at IS NULL
      AND o.payment_status = 'paid'
    GROUP BY o.id, o.order_no, o.created_at, v.name, v.id, v.integration_type, u.email, u.full_name, o.total_amount, o.shipping_address
    ORDER BY o.created_at DESC
  `);

  sendResponse(res, 200, {
    failedOrders: rows,
    count: rows.length
  });
});

/**
 * Get pending vendor orders
 * GET /admin/vendor-orders/pending
 */
exports.getPendingVendorOrders = catchAsync(async (req, res, next) => {
  const { rows } = await dbPool.query(`
    SELECT DISTINCT
      o.id AS order_id,
      o.order_no,
      o.created_at AS order_date,
      v.id AS vendor_id,
      v.name AS vendor_name,
      v.integration_type,
      v.capabilities->>'has_order_placement_api' AS has_api,
      COUNT(oi.id) AS pending_items,
      u.email AS customer_email,
      u.full_name AS customer_name
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE oi.vendor_order_status = 'pending'
      AND oi.deleted_at IS NULL
      AND o.deleted_at IS NULL
      AND o.payment_status = 'paid'
    GROUP BY o.id, o.order_no, o.created_at, v.id, v.name, v.integration_type, v.capabilities, u.email, u.full_name
    ORDER BY o.created_at ASC
  `);

  sendResponse(res, 200, {
    pendingOrders: rows,
    count: rows.length
  });
});

/**
 * Retry failed vendor order
 * POST /admin/vendor-orders/:orderId/retry
 */
exports.retryVendorOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { vendorId } = req.body; // Optional - if not provided, retry all failed vendors

  console.log(`\n🔄 Admin retry requested for order: ${orderId}`);

  const result = await VendorOrderManager.retryFailedOrder(orderId, vendorId);

  sendResponse(res, 200, {
    message: 'Vendor order retry completed',
    result
  });
});

/**
 * Sync tracking for order
 * POST /admin/vendor-orders/:orderId/sync-tracking
 */
exports.syncOrderTracking = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  console.log(`\n🔍 Admin tracking sync requested for order: ${orderId}`);

  const result = await VendorOrderManager.syncTracking(orderId);

  sendResponse(res, 200, {
    message: 'Tracking sync completed',
    result
  });
});

/**
 * Carrier shipment timeline (17TRACK). Query: number, carrier (optional).
 * GET /admin/tracking-timeline?number=...&carrier=FedEx
 * Env: SEVENTEEN_TRACK_API_KEY
 */
exports.getCarrierTrackingTimeline = catchAsync(async (req, res) => {
  const { number, carrier } = req.query;
  const result = await fetchCarrierTimeline(number, carrier);
  return sendResponse(res, 200, true, 'Carrier timeline', result);
});

/**
 * Get order details with vendor placement status
 * GET /admin/vendor-orders/:orderId/details
 */
exports.getOrderDetails = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  const { rows } = await dbPool.query(`
    SELECT
      o.id AS order_id,
      o.order_no,
      o.created_at AS order_date,
      o.payment_status,
      o.total_amount,
      o.shipping_address,
      u.email AS customer_email,
      u.full_name AS customer_name,
      u.phone AS customer_phone,
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', oi.id,
          'product_name', p.name,
          'variant_sku', pv.sku,
          'qty', oi.qty,
          'price', oi.price,
          'vendor_id', v.id,
          'vendor_name', v.name,
          'vendor_order_status', oi.vendor_order_status,
          'vendor_order_id', oi.vendor_order_id,
          'vendor_reference', oi.vendor_reference_number,
          'tracking_codes', oi.tracking_codes,
          'updated_at', oi.updated_at
        )
        ORDER BY v.name, oi.created_at
      ) AS items
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN product_variants pv ON pv.id = oi.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN vendors v ON v.id = oi.vendor_id
    WHERE o.id = $1
      AND o.deleted_at IS NULL
      AND oi.deleted_at IS NULL
    GROUP BY o.id, o.order_no, o.created_at, o.payment_status, o.total_amount, o.shipping_address, u.email, u.full_name, u.phone
  `, [orderId]);

  if (rows.length === 0) {
    return sendResponse(res, 404, { message: 'Order not found' });
  }

  sendResponse(res, 200, {
    order: rows[0]
  });
});

/**
 * Manual place order (for testing or manual triggering)
 * POST /admin/vendor-orders/:orderId/place
 */
exports.manualPlaceOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  console.log(`\n📦 Admin manual place requested for order: ${orderId}`);

  const result = await VendorOrderManager.placeOrderItems(orderId);

  sendResponse(res, 200, {
    message: 'Vendor order placement completed',
    result
  });
});

/**
 * Mark vendor items as paid (after paying on merchant dashboard)
 * POST /admin/vendor-orders/:orderId/mark-paid
 * Body: { vendorId: string } - required, vendor UUID
 */
exports.markVendorPaid = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { vendorId } = req.body;

  if (!vendorId) {
    return sendResponse(res, 400, false, 'vendorId is required');
  }

  const client = await dbPool.connect();
  try {
    const updateResult = await client.query(`
      UPDATE order_items oi
      SET vendor_paid_at = NOW(), updated_at = NOW()
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
      WHERE oi.order_id = $1 AND oi.variant_id = pv.id AND p.vendor_id = $2
        AND oi.deleted_at IS NULL
      RETURNING oi.id
    `, [orderId, vendorId]);

    const updatedCount = updateResult.rowCount || 0;
    sendResponse(res, 200, true, `Marked ${updatedCount} item(s) as paid with vendor`, { updatedCount });
  } finally {
    client.release();
  }
});

/**
 * Unmark vendor items as paid (revert accidental mark)
 * POST /admin/vendor-orders/:orderId/unmark-paid
 * Body: { vendorId: string } - required, vendor UUID
 */
exports.unmarkVendorPaid = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { vendorId } = req.body;

  if (!vendorId) {
    return sendResponse(res, 400, false, 'vendorId is required');
  }

  const client = await dbPool.connect();
  try {
    const updateResult = await client.query(`
      UPDATE order_items oi
      SET vendor_paid_at = NULL, updated_at = NOW()
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
      WHERE oi.order_id = $1 AND oi.variant_id = pv.id AND p.vendor_id = $2
        AND oi.deleted_at IS NULL
      RETURNING oi.id
    `, [orderId, vendorId]);

    const updatedCount = updateResult.rowCount || 0;
    sendResponse(res, 200, true, `Reverted paid status for ${updatedCount} item(s)`, { updatedCount });
  } finally {
    client.release();
  }
});
