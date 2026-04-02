-- List of dashboard route paths this admin can access. Empty array = no extra pages; superadmin ignores this.
-- Example: ["/dashboard/orders", "/dashboard/customers"]
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS allowed_routes JSONB DEFAULT '[]';

COMMENT ON COLUMN admins.allowed_routes IS 'Array of dashboard path strings the admin can access. Ignored for superadmin.';
