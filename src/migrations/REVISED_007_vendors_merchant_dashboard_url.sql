-- Add merchant dashboard URL to vendors (link to vendor's order/dashboard login page)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS merchant_dashboard_url VARCHAR(500) NULL;

COMMENT ON COLUMN vendors.merchant_dashboard_url IS 'URL to vendor merchant dashboard / orders / login page (e.g. BDroppy orders, BrandsGateway questionnaire).';

-- Optional: set known vendor dashboard URLs by name (adjust names if your DB differs)
UPDATE vendors SET merchant_dashboard_url = 'https://www.bdroppy.com/order?lang=en_US' WHERE LOWER(name) LIKE '%bdroppy%' AND merchant_dashboard_url IS NULL;
UPDATE vendors SET merchant_dashboard_url = 'https://api.luxury-distribution.com/merchant/login' WHERE LOWER(name) LIKE '%luxury%' AND merchant_dashboard_url IS NULL;
UPDATE vendors SET merchant_dashboard_url = 'https://app.brandsgateway.com/questionnaire/' WHERE LOWER(name) LIKE '%brandsgateway%' AND merchant_dashboard_url IS NULL;
UPDATE vendors SET merchant_dashboard_url = 'https://peppela.com/login?back=my-account' WHERE LOWER(name) LIKE '%peppela%' AND merchant_dashboard_url IS NULL;
