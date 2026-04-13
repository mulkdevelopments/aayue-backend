// migrationFiles.js
var migrationFiles = [
  `-- Admins
CREATE TABLE IF NOT EXISTS admins(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'superadmin',
    is_active BOOLEAN DEFAULT true,
    magic_token TEXT,
    magic_token_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);
CREATE INDEX IF NOT EXISTS idx_admins_is_active ON admins(is_active);
`,

  `-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(150),
  password_hash TEXT,
  full_name VARCHAR(120),
  magic_token TEXT,
  magic_token_expires TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
`,

  `-- Addresses
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(60),
  street TEXT,
  city VARCHAR(120),
  state VARCHAR(120),
  postal_code VARCHAR(30),
  country VARCHAR(80),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  mobile VARCHAR(30),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_is_default ON addresses(is_default);
`,

  `-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  contact_email VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendors_slug ON vendors(slug);
`,

  `-- Products
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pid BIGSERIAL, -- optional short numeric id
  vendor_id UUID REFERENCES vendors(id),
  productid VARCHAR(255), -- external product id
  product_sku VARCHAR(255) UNIQUE, -- product level SKU (may be same as variant sku or a master sku)
  productpartnersku VARCHAR(255), -- partner/vendor SKU
  name VARCHAR(512) NOT NULL,
  title VARCHAR(512),
  short_description TEXT,
  description TEXT,
  brand_name VARCHAR(255),
  brand_name_normalized VARCHAR(255),
  gender VARCHAR(50),
  default_category_id UUID,
  attributes JSONB, -- flexible attributes
  product_meta JSONB,
  sizechart_text TEXT,
  sizechart_image VARCHAR(1024),
  shipping_returns_payments JSONB,
  environmental_impact JSONB,
  product_img VARCHAR(1024),
  product_img1 VARCHAR(1024),
  product_img2 VARCHAR(1024),
  product_img3 VARCHAR(1024),
  product_img4 VARCHAR(1024),
  product_img5 VARCHAR(1024),
  videos JSONB, -- array of video URLs
  delivery_time VARCHAR(128),
  cod_available BOOLEAN DEFAULT false,
  supplier VARCHAR(255),
  country_of_origin VARCHAR(128),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_name);
CREATE INDEX IF NOT EXISTS idx_products_brand_normalized ON products(brand_name_normalized);
CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_productid ON products(productid);
`,

  `-- Product variants
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pid BIGSERIAL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  sku VARCHAR(255) NOT NULL UNIQUE,
  barcode VARCHAR(128),
  vendor_product_id VARCHAR(255),
  productpartnersku VARCHAR(255),
  price NUMERIC(12,2) NOT NULL,
  mrp NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  stock BIGINT DEFAULT 0,
  weight NUMERIC(10,3),
  dimension JSONB, -- {length, width, height} OR you can keep separate numeric columns
  length NUMERIC(10,3),
  width NUMERIC(10,3),
  height NUMERIC(10,3),
  attributes JSONB,
  images JSONB,
  image_urls JSONB,
  video1 VARCHAR(1024),
  video2 VARCHAR(1024),
  vendormrp NUMERIC(12,2),
  vendorsaleprice NUMERIC(12,2),
  ourmrp NUMERIC(12,2),
  oursaleprice NUMERIC(12,2),
  tax JSONB, -- {tax1:.., tax2:.., tax3:..}
  tax1 NUMERIC(8,2),
  tax2 NUMERIC(8,2),
  tax3 NUMERIC(8,2),
  variant_color VARCHAR(128),
  variant_size VARCHAR(128),
  country_of_origin VARCHAR(128),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_variants_price ON product_variants(price);
CREATE INDEX IF NOT EXISTS idx_variants_stock ON product_variants(stock);
CREATE INDEX IF NOT EXISTS idx_variants_variant_color ON product_variants(variant_color);
CREATE INDEX IF NOT EXISTS idx_variants_variant_size ON product_variants(variant_size);
`,

  `-- Media
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  variant_id UUID REFERENCES product_variants(id),
  url TEXT NOT NULL,
  type VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
`,

  `-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  lft INT,
  rgt INT,
  path TEXT,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
`,

  `-- Product categories
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_categories_product_id ON product_categories(product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category_id ON product_categories(category_id);
`,

  `-- Product dynamic filters
CREATE TABLE IF NOT EXISTS product_dynamic_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  filter_type VARCHAR(100),
  filter_name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_dynamic_filters_product_id ON product_dynamic_filters(product_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_filters_type_name ON product_dynamic_filters(filter_type, filter_name);
`,

  `-- Inventory transactions
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  change BIGINT NOT NULL,
  reason VARCHAR(255),
  reference_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_variant_id ON inventory_transactions(variant_id);
`,

  `-- Carts & cart_items
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID REFERENCES carts(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id),
  qty INT NOT NULL DEFAULT 1,
  price NUMERIC(12,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant_id ON cart_items(variant_id);
`,

  `-- Orders & order_items
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(128) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),
  vendor_id UUID REFERENCES vendors(id),
  total_amount NUMERIC(12,2),
  payment_status VARCHAR(50),
  order_status VARCHAR(50),
  shipping_address JSONB,
  billing_address JSONB,
  stripe_payment_intent_id VARCHAR(255),
  stripe_session_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id),
  qty INT NOT NULL,
  price NUMERIC(12,2),
  vendor_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);
`,

  `-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2),
  method VARCHAR(50),
  provider_response JSONB,
  status VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
`,

  `-- Coupons
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL,
  value NUMERIC(12,2),
  max_discount NUMERIC(12,2),
  currency VARCHAR(10) DEFAULT 'AED',
  scope_type VARCHAR(50) NOT NULL,
  scope_ids JSONB,
  min_subtotal NUMERIC(12,2) DEFAULT 0,
  first_order_only BOOLEAN DEFAULT false,
  allowed_user_ids JSONB,
  excluded_product_ids JSONB,
  start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  channels JSONB DEFAULT '["WEB"]'::jsonb,
  usage_limit_total INT DEFAULT 0,
  usage_limit_per_user INT DEFAULT 0,
  stack_group VARCHAR(100),
  priority INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  CONSTRAINT chk_coupon_type CHECK (type IN ('PERCENT', 'FLAT', 'FREE_SHIP', 'BOGO')),
  CONSTRAINT chk_scope_type CHECK (scope_type IN ('GLOBAL', 'PRODUCT', 'CATEGORY', 'CART')),
  CONSTRAINT chk_status CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'))
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_validity ON coupons(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
CREATE INDEX IF NOT EXISTS idx_coupons_type ON coupons(type);
`,

  `-- Wallets & wallet_transactions
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id),
  balance NUMERIC(14,2) DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  change NUMERIC(14,2),
  type VARCHAR(100),
  reference JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id);
`,

  `-- Product import runs
CREATE TABLE IF NOT EXISTS product_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(512),
  vendor_id UUID,
  status VARCHAR(50),
  summary JSONB,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_runs_vendor_id ON product_import_runs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_import_runs_status ON product_import_runs(status);
`,

  `-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(255),
  record_id UUID,
  action VARCHAR(50),
  payload JSONB,
  performed_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_action ON audit_logs(table_name, action);
`,

  `-- Magic links
CREATE TABLE IF NOT EXISTS magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_links_user_id ON magic_links(user_id);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires_used ON magic_links(expires_at, used);
`,

  `-- 1_create_best_sellers.sql
CREATE TABLE IF NOT EXISTS best_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id UUID NULL REFERENCES vendors(id),
  rank INT DEFAULT NULL,                -- optional ordering (1 = top)
  meta JSONB DEFAULT '{}'::jsonb,       -- free-form metadata (promo text, badge, etc)
  active BOOLEAN DEFAULT true,
  start_at TIMESTAMP WITH TIME ZONE DEFAULT NULL, -- when to start showing
  end_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,   -- optional end
  created_by UUID NULL,                 -- admin id who added it
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_best_sellers_product ON best_sellers(product_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_best_sellers_rank ON best_sellers(rank);
CREATE INDEX IF NOT EXISTS idx_best_sellers_active_dates ON best_sellers(active, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_best_sellers_vendor_id ON best_sellers(vendor_id);
`,

  `-- 2025xx_create_brand_spotlights.sql
CREATE TABLE IF NOT EXISTS brand_spotlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name VARCHAR(255) NOT NULL,      -- canonical brand label (searchable)
  vendor_id UUID NULL,                   -- optional vendor associated with brand
  meta JSONB DEFAULT '{}'::jsonb,        -- e.g. { badge, promo_text, hero_image }
  rank INT DEFAULT NULL,                 -- ordering (lower = higher)
  active BOOLEAN DEFAULT true,
  start_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  end_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_by UUID NULL,                  -- admin id who created
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_spotlights_brand ON brand_spotlights(brand_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_spotlights_rank ON brand_spotlights(rank);
CREATE INDEX IF NOT EXISTS idx_brand_spotlights_active_dates ON brand_spotlights(active, start_at, end_at);
`,

  `-- 2025xx_create_brand_groups.sql
CREATE TABLE IF NOT EXISTS brand_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  meta JSONB DEFAULT '{}'::jsonb,
  rank INT DEFAULT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS brand_group_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES brand_groups(id) ON DELETE CASCADE,
  brand_name VARCHAR(255) NOT NULL,
  rank INT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_group_brand
  ON brand_group_brands(group_id, brand_name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brand_groups_rank ON brand_groups(rank);
CREATE INDEX IF NOT EXISTS idx_brand_groups_active ON brand_groups(active);
CREATE INDEX IF NOT EXISTS idx_brand_group_brands_rank ON brand_group_brands(rank);
`,

  `-- 2025xx_create_new_arrivals.sql
CREATE TABLE IF NOT EXISTS new_arrivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rank INT DEFAULT NULL,                -- ordering, lower = earlier in list
  meta JSONB DEFAULT '{}'::jsonb,       -- { badge, promo_text, note }
  active BOOLEAN DEFAULT true,
  start_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,  -- scheduling window optional
  end_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_by UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_new_arrivals_product_id ON new_arrivals(product_id);
CREATE INDEX IF NOT EXISTS idx_new_arrivals_rank ON new_arrivals(rank);
CREATE INDEX IF NOT EXISTS idx_new_arrivals_active_dates ON new_arrivals(active, start_at, end_at);
`,

  `
CREATE TABLE IF NOT EXISTS home_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,               -- 'brand_spotlight' | 'new_arrivals' | 'best_seller' | 'sale'
  label TEXT,                             -- human friendly label
  active BOOLEAN DEFAULT FALSE,
  meta JSONB DEFAULT '{}'::jsonb,         -- optional UI settings (title, subtitle, layout, limit, etc.)
  rank INT DEFAULT NULL,                  -- ordering for frontend
  created_by UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_sections_key ON home_sections(key);
CREATE INDEX IF NOT EXISTS idx_home_sections_active ON home_sections(active);

-- Seed default rows if not present
INSERT INTO home_sections (key, label, active, meta, rank)
SELECT v.k, v.l, v.a, v.m::jsonb, v.r
FROM (VALUES
  ('brand_spotlight','Brand Spotlights', TRUE, '{"title":"Featured Brands","limit":4}'::text, 1),
  ('new_arrivals','New Arrivals', TRUE, '{"title":"New This Week","limit":12}'::text, 2),
  ('best_seller','Best Sellers', TRUE, '{"title":"Top Selling","limit":8}'::text, 3),
  ('sale','Sale', TRUE, '{"title":"On Sale","limit":12}'::text, 4)
) v(k,l,a,m,r)
WHERE NOT EXISTS (SELECT 1 FROM home_sections s WHERE s.key = v.k);
`,

  `CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rank INT DEFAULT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  discount_percent NUMERIC(5,2) DEFAULT 0, -- <== important
  active BOOLEAN DEFAULT true,
  start_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  end_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_by UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
`,

  `-- Home banners table for managing homepage banners
CREATE TABLE IF NOT EXISTS home_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot VARCHAR(100) NOT NULL UNIQUE,        -- 'top-banner', 'below-top-banner', 'middle-banner', 'bottom-top-banner', 'bottom-left-banner', 'bottom-right-banner'
  media_type VARCHAR(50),                   -- 'image' | 'video'
  media_url TEXT,                           -- URL to the media file
  title VARCHAR(255),                       -- Optional title text
  subtitle TEXT,                            -- Optional subtitle
  button_text VARCHAR(100),                 -- Optional button text
  link_url TEXT,                            -- Optional navigation URL
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,                 -- For ordering banners
  metadata JSONB,                           -- Additional flexible data
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_banners_slot ON home_banners(slot);
CREATE INDEX IF NOT EXISTS idx_home_banners_is_active ON home_banners(is_active);
CREATE INDEX IF NOT EXISTS idx_home_banners_sort_order ON home_banners(sort_order);
`,

  `-- Overlay grid table for homepage overlay items
CREATE TABLE IF NOT EXISTS overlaygrid (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255),
  mrp NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  product_image TEXT,
  product_redirect_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
`,

  `-- Sale by category table for category-based sales/promotions
CREATE TABLE IF NOT EXISTS sale_by_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT,
  redirect_url TEXT,
  title VARCHAR(255),
  button_text VARCHAR(100),
  created_by UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_by_category_created_at ON sale_by_category(created_at DESC);
`,

  `-- Multi-currency support: Exchange rates table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS currency_exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency TEXT NOT NULL DEFAULT 'EUR',
  to_currency TEXT NOT NULL,
  rate DECIMAL(10, 4) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_exchange_rates(from_currency, to_currency);

COMMENT ON TABLE currency_exchange_rates IS 'Real-time currency exchange rates (EUR to other currencies). Updated every 6 hours by cron job.';

-- Insert initial exchange rates
INSERT INTO currency_exchange_rates (to_currency, rate, updated_at) VALUES
  ('AED', 4.0, NOW()),
  ('INR', 90.0, NOW()),
  ('PKR', 305.0, NOW())
ON CONFLICT (from_currency, to_currency) DO NOTHING;
`,

  `-- Multi-currency support: Add markup_percent to product_variants
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS markup_percent DECIMAL(5, 2);

COMMENT ON COLUMN product_variants.markup_percent IS 'Product-specific markup percentage applied on vendor EUR price (default 20%). Editable by admin.';

-- Calculate markup from existing data (runs only if markup_percent is NULL)
UPDATE product_variants
SET markup_percent = CASE
  WHEN vendorsaleprice IS NOT NULL
    AND vendorsaleprice > 0
    AND sale_price IS NOT NULL
    AND sale_price > 0
    AND sale_price > vendorsaleprice
  THEN ROUND(((sale_price / vendorsaleprice) - 1) * 100, 2)
  ELSE 20.0
END
WHERE markup_percent IS NULL;
`,

  `-- Multi-currency support: Add additional fields to product_variants
ALTER TABLE product_variants
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id),
ADD COLUMN IF NOT EXISTS currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS conversion_rate DECIMAL(10, 4),
ADD COLUMN IF NOT EXISTS vmrp_to_aed VARCHAR(50),
ADD COLUMN IF NOT EXISTS vsale_to_aed VARCHAR(50),
ADD COLUMN IF NOT EXISTS normalized_size VARCHAR(128),
ADD COLUMN IF NOT EXISTS normalized_color VARCHAR(128),
ADD COLUMN IF NOT EXISTS size_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_variants_vendor_id ON product_variants(vendor_id);
CREATE INDEX IF NOT EXISTS idx_variants_normalized_size ON product_variants(normalized_size);
CREATE INDEX IF NOT EXISTS idx_variants_normalized_color ON product_variants(normalized_color);
`,

  `-- 2026xx_add_brand_name_normalized.sql
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS brand_name_normalized VARCHAR(255);

UPDATE products
SET brand_name_normalized = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(unaccent(TRIM(brand_name)), '[^a-zA-Z0-9]+', ' ', 'g'),
    '\\s+', ' ', 'g'
  )
)
WHERE brand_name IS NOT NULL;

UPDATE products
SET brand_name_normalized = NULL
WHERE brand_name_normalized = '';

CREATE INDEX IF NOT EXISTS idx_products_brand_normalized
ON products (brand_name_normalized);
`,

  `-- 2026xx_add_apple_sub_to_users.sql
ALTER TABLE users
ADD COLUMN IF NOT EXISTS apple_sub VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS users_apple_sub_key
ON users (apple_sub)
WHERE apple_sub IS NOT NULL;
`,

  `-- Access requests (non-allowed domains request access; admin can send magic link)
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  magic_link_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_access_requests_created_at ON access_requests(created_at DESC);
`,

  `-- Stock notify requests
CREATE TABLE IF NOT EXISTS stock_notify_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(512),
  brand_name VARCHAR(255),
  product_image VARCHAR(1024),
  requested_size VARCHAR(128),
  email VARCHAR(255) NOT NULL,
  wants_marketing BOOLEAN DEFAULT false,
  status VARCHAR(32) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_notify_email ON stock_notify_requests(email);
CREATE INDEX IF NOT EXISTS idx_stock_notify_product_id ON stock_notify_requests(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_notify_status ON stock_notify_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_notify_unique
  ON stock_notify_requests(product_id, requested_size, email)
  WHERE deleted_at IS NULL;
`,

  `-- Hero section slides (homepage hero carousel: title, description, image, CTA link)
CREATE TABLE IF NOT EXISTS hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image_url TEXT,
  redirect_url VARCHAR(1024) DEFAULT '/shop',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_hero_slides_active ON hero_slides(is_active);
CREATE INDEX IF NOT EXISTS idx_hero_slides_sort_order ON hero_slides(sort_order);
`,

  `-- Custom duties per currency (display-only on frontend; e.g. 42% for India)
CREATE TABLE IF NOT EXISTS custom_duties (
  currency_code VARCHAR(10) PRIMARY KEY,
  duty_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
COMMENT ON TABLE custom_duties IS 'Custom duty percentage per country/currency for frontend price display (e.g. 42 for India).';
`,

  `-- Homepage brand highlight tiles (admin: brand + portrait image → shop link)
CREATE TABLE IF NOT EXISTS brand_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name VARCHAR(255) NOT NULL,
  display_label VARCHAR(255),
  image_url TEXT NOT NULL,
  link_url VARCHAR(1024),
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_highlights_active ON brand_highlights(active);
CREATE INDEX IF NOT EXISTS idx_brand_highlights_sort ON brand_highlights(sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_highlights_brand_alive
  ON brand_highlights (lower(trim(brand_name)))
  WHERE deleted_at IS NULL;
COMMENT ON TABLE brand_highlights IS 'Curated brand tiles on homepage; brand_name matches catalog.';
`,

  `-- Perf: product_our_category_map for getDynamicFilters / PLP (category-scoped joins)
CREATE INDEX IF NOT EXISTS idx_pom_our_category_id ON product_our_category_map(our_category_id);
CREATE INDEX IF NOT EXISTS idx_pom_product_id ON product_our_category_map(product_id);
`,

  `-- Size normalization: canonical size + size type for clean filtering
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS normalized_size_final VARCHAR(128);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_size_type_canonical
  ON product_variants(size_type, normalized_size_final)
  WHERE deleted_at IS NULL AND normalized_size_final IS NOT NULL;
`,
];

module.exports = migrationFiles;
