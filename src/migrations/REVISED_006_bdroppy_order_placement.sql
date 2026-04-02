-- Enable order placement and tracking for BDroppy vendor.
-- Run after BdroppyOrderService is deployed. Vendor id: a6bdd96b-0e2c-4f3e-b644-4e088b1778e0

UPDATE vendors
SET capabilities = jsonb_set(
  jsonb_set(
    COALESCE(capabilities, '{}'::jsonb),
    '{has_order_placement_api}',
    'true'
  ),
  '{has_order_tracking_api}',
  'true'
)
WHERE id = 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0'
  AND deleted_at IS NULL;
