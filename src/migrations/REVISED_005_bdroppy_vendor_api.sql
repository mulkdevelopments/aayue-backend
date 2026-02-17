-- Set BDroppy vendor to API integration (product sync). Run after BDroppy API sync is deployed.
-- Vendor id: a6bdd96b-0e2c-4f3e-b644-4e088b1778e0

UPDATE vendors
SET
  integration_type = 'api',
  capabilities = '{
    "stock_management": "sync_based",
    "has_stock_check_api": false,
    "order_placement_type": "atomic",
    "has_individual_syncing": false,
    "has_order_tracking_api": false,
    "has_order_placement_api": false,
    "has_order_cancellation_api": false
  }'::jsonb
WHERE id = 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0'
  AND deleted_at IS NULL;
