
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS integration_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_vendors_integration_type ON vendors(integration_type);
CREATE INDEX IF NOT EXISTS idx_vendors_capabilities ON vendors USING GIN (capabilities);

-- Comments for documentation
COMMENT ON COLUMN vendors.integration_type IS 'Type of integration: luxury_distribution, manual, shopify, etc.';
COMMENT ON COLUMN vendors.capabilities IS 'JSONB capabilities object. Example:
{
  "has_order_placement_api": true,
  "has_order_tracking_api": true,
  "order_placement_type": "atomic"  // "atomic" = all items succeed/fail together, "individual" = per-item
}';


we dont need updated_at,is_active(becouse we already have status:active/inactive in vendors table), for integration_type we already have name: Luxury-Distribution/ Griffati/Brandsgateway.., but we can use integration_type:api/csv/manual(so we can know what each vendor use to integrate with us)

-- Run this AFTER the migration to configure your LD vendor:

UPDATE vendors
SET
  integration_type = 'api',
  capabilities = '{
    "has_order_placement_api": true,
    "has_order_tracking_api": true,
    "has_order_cancellation_api": false,
    "has_stock_check_api": false,
    "order_placement_type": "atomic",
    "stock_management": "sync_based"
  }'::jsonb,
WHERE id = '65053474-4e40-44ee-941c-ef5253ea9fc9';
