-- Migration: Create helpful views for vendor order management (SIMPLIFIED)
-- Description: Admin dashboard views for monitoring vendor orders
-- Date: 2026-01-07
-- Status: OPTIONAL - Create if you want admin dashboard views

-- ============================================================================
-- View 1: Vendor Orders Summary
-- Shows orders grouped by vendor with placement status
-- ============================================================================

CREATE OR REPLACE VIEW vendor_orders_summary AS
SELECT
  o.id AS order_id,
  o.order_no,
  o.created_at AS order_date,
  o.payment_status,
  u.email AS customer_email,
  u.full_name AS customer_name,

  -- Vendor info
  v.id AS vendor_id,
  v.name AS vendor_name,
  v.integration_type,

  -- Item counts
  COUNT(oi.id) AS total_items,
  SUM(oi.qty) AS total_qty,
  SUM(oi.price * oi.qty) AS total_amount,

  -- Placement status counts
  COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'placed') AS items_placed,
  COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'failed') AS items_failed,
  COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'pending') AS items_pending,

  -- Vendor order info (same for all items in atomic orders)
  MAX(oi.vendor_order_id) AS vendor_order_id,
  MAX(oi.vendor_reference_number) AS vendor_reference,

  -- Overall status
  CASE
    WHEN COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'placed') = COUNT(oi.id) THEN 'fully_placed'
    WHEN COUNT(oi.id) FILTER (WHERE oi.vendor_order_status = 'failed') > 0 THEN 'failed'
    ELSE 'pending'
  END AS placement_status

FROM orders o
JOIN users u ON u.id = o.user_id
JOIN order_items oi ON oi.order_id = o.id
JOIN vendors v ON v.id = oi.vendor_id
WHERE o.deleted_at IS NULL AND oi.deleted_at IS NULL
GROUP BY o.id, o.order_no, o.created_at, o.payment_status, u.email, u.full_name, v.id, v.name, v.integration_type
ORDER BY o.created_at DESC;

COMMENT ON VIEW vendor_orders_summary IS 'Summary of all orders grouped by vendor, showing placement status';

-- ============================================================================
-- View 2: Failed Vendor Orders (Needs Attention)
-- Orders where vendor API call failed
-- ============================================================================

CREATE OR REPLACE VIEW failed_vendor_orders AS
SELECT DISTINCT
  o.id AS order_id,
  o.order_no,
  o.created_at AS order_date,
  v.name AS vendor_name,
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
  AND o.payment_status = 'paid'  -- Only show paid orders (customer already charged)
GROUP BY o.id, o.order_no, o.created_at, v.name, v.integration_type, u.email, u.full_name, o.total_amount, o.shipping_address
ORDER BY o.created_at DESC;

COMMENT ON VIEW failed_vendor_orders IS 'Paid orders where vendor order placement failed - needs admin attention';

-- ============================================================================
-- View 3: Pending Vendor Orders (Not Yet Placed)
-- Orders waiting to be placed with vendor
-- ============================================================================

CREATE OR REPLACE VIEW pending_vendor_orders AS
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
ORDER BY o.created_at ASC;  -- Oldest first

COMMENT ON VIEW pending_vendor_orders IS 'Paid orders with items not yet placed with vendor';

-- ============================================================================
-- View 4: Order Tracking Summary (Customer-Facing)
-- Tracking information for all orders
-- ============================================================================

CREATE OR REPLACE VIEW order_tracking_summary AS
SELECT
  o.id AS order_id,
  o.order_no,
  o.created_at AS order_date,
  u.email AS customer_email,

  -- Aggregate all tracking info
  jsonb_agg(
    DISTINCT jsonb_build_object(
      'vendor_name', v.name,
      'vendor_order_id', oi.vendor_order_id,
      'vendor_reference', oi.vendor_reference_number,
      'items', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_name', p.name,
            'qty', oi2.qty,
            'status', oi2.vendor_order_status
          )
        )
        FROM order_items oi2
        JOIN product_variants pv2 ON pv2.id = oi2.variant_id
        JOIN products p ON p.id = pv2.product_id
        WHERE oi2.vendor_order_id = oi.vendor_order_id
          AND oi2.order_id = o.id
      ),
      'tracking_codes', oi.tracking_codes,
      'status', oi.vendor_order_status
    )
  ) FILTER (WHERE oi.vendor_order_status != 'pending') AS shipments

FROM orders o
JOIN users u ON u.id = o.user_id
JOIN order_items oi ON oi.order_id = o.id
JOIN vendors v ON v.id = oi.vendor_id
WHERE o.deleted_at IS NULL
  AND oi.deleted_at IS NULL
  AND o.payment_status = 'paid'
GROUP BY o.id, o.order_no, o.created_at, u.email
ORDER BY o.created_at DESC;

COMMENT ON VIEW order_tracking_summary IS 'Customer-facing tracking information aggregated by vendor order';

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================
--
-- Admin Dashboard - Get failed orders:
--   SELECT * FROM failed_vendor_orders LIMIT 20;
--
-- Admin Dashboard - Get pending orders:
--   SELECT * FROM pending_vendor_orders WHERE vendor_name = 'Luxury Distribution';
--
-- Customer Portal - Get order tracking:
--   SELECT * FROM order_tracking_summary WHERE order_no = 'ORD-12345';
--
-- Admin Analytics - Vendor placement success rate:
--   SELECT
--     vendor_name,
--     SUM(items_placed) AS total_placed,
--     SUM(items_failed) AS total_failed,
--     ROUND(100.0 * SUM(items_placed) / NULLIF(SUM(total_items), 0), 2) AS success_rate
--   FROM vendor_orders_summary
--   WHERE order_date >= NOW() - INTERVAL '30 days'
--   GROUP BY vendor_name;
--
-- ============================================================================
