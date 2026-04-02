-- Adminer 4.8.1 PostgreSQL 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1) dump

DROP TABLE IF EXISTS "addresses";
CREATE TABLE "public"."addresses" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "label" character varying(60),
    "street" text,
    "city" character varying(120),
    "state" character varying(120),
    "postal_code" character varying(30),
    "country" character varying(80),
    "lat" double precision,
    "lon" double precision,
    "is_default" boolean DEFAULT false,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    "mobile" character varying(30),
    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_addresses_is_default" ON "public"."addresses" USING btree ("is_default");

CREATE INDEX "idx_addresses_user_id" ON "public"."addresses" USING btree ("user_id");


DROP TABLE IF EXISTS "admins";
CREATE TABLE "public"."admins" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "email" character varying(255) NOT NULL,
    "name" character varying(255),
    "role" character varying(50) DEFAULT 'superadmin',
    "is_active" boolean DEFAULT true,
    "magic_token" text,
    "magic_token_expires" timestamptz,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "admins_email_key" UNIQUE ("email"),
    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_admins_email" ON "public"."admins" USING btree ("email");

CREATE INDEX "idx_admins_is_active" ON "public"."admins" USING btree ("is_active");

CREATE INDEX "idx_admins_role" ON "public"."admins" USING btree ("role");


DROP TABLE IF EXISTS "audit_logs";
CREATE TABLE "public"."audit_logs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "table_name" character varying(255),
    "record_id" uuid,
    "action" character varying(50),
    "payload" jsonb,
    "performed_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_audit_logs_table_action" ON "public"."audit_logs" USING btree ("table_name", "action");


DROP TABLE IF EXISTS "best_sellers";
CREATE TABLE "public"."best_sellers" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid NOT NULL,
    "vendor_id" uuid,
    "rank" integer,
    "meta" jsonb DEFAULT '{}',
    "active" boolean DEFAULT true,
    "start_at" timestamptz,
    "end_at" timestamptz,
    "created_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "best_sellers_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_best_sellers_active_dates" ON "public"."best_sellers" USING btree ("active", "start_at", "end_at");

CREATE INDEX "idx_best_sellers_rank" ON "public"."best_sellers" USING btree ("rank");

CREATE INDEX "idx_best_sellers_vendor_id" ON "public"."best_sellers" USING btree ("vendor_id");

CREATE INDEX "ux_best_sellers_product" ON "public"."best_sellers" USING btree ("product_id");


DROP TABLE IF EXISTS "brand_spotlights";
CREATE TABLE "public"."brand_spotlights" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "brand_name" character varying(255) NOT NULL,
    "vendor_id" uuid,
    "meta" jsonb DEFAULT '{}',
    "rank" integer,
    "active" boolean DEFAULT true,
    "start_at" timestamptz,
    "end_at" timestamptz,
    "created_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "brand_spotlights_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_brand_spotlights_active_dates" ON "public"."brand_spotlights" USING btree ("active", "start_at", "end_at");

CREATE INDEX "idx_brand_spotlights_rank" ON "public"."brand_spotlights" USING btree ("rank");

CREATE INDEX "ux_brand_spotlights_brand" ON "public"."brand_spotlights" USING btree ("brand_name");


DROP TABLE IF EXISTS "cart_items";
CREATE TABLE "public"."cart_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "cart_id" uuid,
    "variant_id" uuid,
    "qty" integer DEFAULT '1' NOT NULL,
    "price" numeric(12,2),
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_cart_items_cart_id" ON "public"."cart_items" USING btree ("cart_id");

CREATE INDEX "idx_cart_items_variant_id" ON "public"."cart_items" USING btree ("variant_id");


DROP TABLE IF EXISTS "carts";
CREATE TABLE "public"."carts" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_carts_user_id" ON "public"."carts" USING btree ("user_id");


DROP TABLE IF EXISTS "categories";
CREATE TABLE "public"."categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(255) NOT NULL,
    "slug" character varying(255),
    "parent_id" uuid,
    "lft" integer,
    "rgt" integer,
    "path" text,
    "is_active" boolean DEFAULT true,
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_slug_key" UNIQUE ("slug")
) WITH (oids = false);

CREATE INDEX "idx_categories_parent_id" ON "public"."categories" USING btree ("parent_id");

CREATE INDEX "idx_categories_slug" ON "public"."categories" USING btree ("slug");


DROP TABLE IF EXISTS "coupons";
CREATE TABLE "public"."coupons" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" character varying(100),
    "description" text,
    "discount_type" character varying(50),
    "discount_value" numeric(12,2),
    "min_order_value" numeric(12,2),
    "valid_from" timestamptz,
    "valid_to" timestamptz,
    "usage_limit" integer,
    "used_count" integer DEFAULT '0',
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "coupons_code_key" UNIQUE ("code"),
    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_coupons_code" ON "public"."coupons" USING btree ("code");

CREATE INDEX "idx_coupons_validity" ON "public"."coupons" USING btree ("valid_from", "valid_to");


DROP TABLE IF EXISTS "home_sections";
CREATE TABLE "public"."home_sections" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "key" text NOT NULL,
    "label" text,
    "active" boolean DEFAULT false,
    "meta" jsonb DEFAULT '{}',
    "rank" integer,
    "created_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "home_sections_key_key" UNIQUE ("key"),
    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_home_sections_active" ON "public"."home_sections" USING btree ("active");

CREATE INDEX "idx_home_sections_key" ON "public"."home_sections" USING btree ("key");


DROP TABLE IF EXISTS "inventory_transactions";
CREATE TABLE "public"."inventory_transactions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "variant_id" uuid,
    "change" bigint NOT NULL,
    "reason" character varying(255),
    "reference_id" uuid,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_inventory_variant_id" ON "public"."inventory_transactions" USING btree ("variant_id");


DROP TABLE IF EXISTS "magic_links";
CREATE TABLE "public"."magic_links" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "token_hash" character varying(255) NOT NULL,
    "expires_at" timestamptz NOT NULL,
    "used" boolean DEFAULT false,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_magic_links_expires_used" ON "public"."magic_links" USING btree ("expires_at", "used");

CREATE INDEX "idx_magic_links_user_id" ON "public"."magic_links" USING btree ("user_id");


DROP TABLE IF EXISTS "media";
CREATE TABLE "public"."media" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(255),
    "variant_id" uuid,
    "url" text NOT NULL,
    "type" character varying(50),
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
) WITH (oids = false);


DROP TABLE IF EXISTS "new_arrivals";
CREATE TABLE "public"."new_arrivals" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid NOT NULL,
    "rank" integer,
    "meta" jsonb DEFAULT '{}',
    "active" boolean DEFAULT true,
    "start_at" timestamptz,
    "end_at" timestamptz,
    "created_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "new_arrivals_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_new_arrivals_active_dates" ON "public"."new_arrivals" USING btree ("active", "start_at", "end_at");

CREATE INDEX "idx_new_arrivals_product_id" ON "public"."new_arrivals" USING btree ("product_id");

CREATE INDEX "idx_new_arrivals_rank" ON "public"."new_arrivals" USING btree ("rank");


DROP TABLE IF EXISTS "order_items";
CREATE TABLE "public"."order_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid,
    "variant_id" uuid,
    "qty" integer NOT NULL,
    "price" numeric(12,2),
    "vendor_id" uuid,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING btree ("order_id");

CREATE INDEX "idx_order_items_variant_id" ON "public"."order_items" USING btree ("variant_id");


DROP TABLE IF EXISTS "orders";
CREATE TABLE "public"."orders" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_no" character varying(128) NOT NULL,
    "user_id" uuid,
    "vendor_id" uuid,
    "total_amount" numeric(12,2),
    "payment_status" character varying(50),
    "order_status" character varying(50),
    "shipping_address" jsonb,
    "billing_address" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    "stripe_session_id" character varying(255),
    "stripe_payment_intent" character varying(255),
    CONSTRAINT "orders_order_no_key" UNIQUE ("order_no"),
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_orders_status" ON "public"."orders" USING btree ("order_status");

CREATE INDEX "idx_orders_user_id" ON "public"."orders" USING btree ("user_id");

CREATE INDEX "idx_orders_vendor_id" ON "public"."orders" USING btree ("vendor_id");


DROP TABLE IF EXISTS "payments";
CREATE TABLE "public"."payments" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid,
    "amount" numeric(12,2),
    "method" character varying(50),
    "provider_response" jsonb,
    "status" character varying(50),
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_payments_order_id" ON "public"."payments" USING btree ("order_id");

CREATE INDEX "idx_payments_status" ON "public"."payments" USING btree ("status");


DROP TABLE IF EXISTS "product_categories";
CREATE TABLE "public"."product_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid,
    "category_id" uuid,
    "deleted_at" timestamptz,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_product_categories_category_id" ON "public"."product_categories" USING btree ("category_id");

CREATE INDEX "idx_product_categories_product_id" ON "public"."product_categories" USING btree ("product_id");


DROP TABLE IF EXISTS "product_dynamic_filters";
CREATE TABLE "public"."product_dynamic_filters" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid,
    "filter_type" character varying(100),
    "filter_name" character varying(255),
    "deleted_at" timestamptz,
    CONSTRAINT "product_dynamic_filters_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_dynamic_filters_product_id" ON "public"."product_dynamic_filters" USING btree ("product_id");

CREATE INDEX "idx_dynamic_filters_type_name" ON "public"."product_dynamic_filters" USING btree ("filter_type", "filter_name");


DROP TABLE IF EXISTS "product_import_runs";
CREATE TABLE "public"."product_import_runs" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "filename" character varying(512),
    "vendor_id" uuid,
    "status" character varying(50),
    "summary" jsonb,
    "started_at" timestamptz,
    "finished_at" timestamptz,
    "deleted_at" timestamptz,
    CONSTRAINT "product_import_runs_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_import_runs_status" ON "public"."product_import_runs" USING btree ("status");

CREATE INDEX "idx_import_runs_vendor_id" ON "public"."product_import_runs" USING btree ("vendor_id");


DROP TABLE IF EXISTS "product_variants";
DROP SEQUENCE IF EXISTS product_variants_pid_seq;
CREATE SEQUENCE product_variants_pid_seq INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE TABLE "public"."product_variants" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "pid" bigint DEFAULT nextval('product_variants_pid_seq') NOT NULL,
    "product_id" uuid,
    "sku" character varying(255) NOT NULL,
    "barcode" character varying(128),
    "vendor_product_id" character varying(255),
    "productpartnersku" character varying(255),
    "price" numeric(12,2) NOT NULL,
    "mrp" numeric(12,2),
    "sale_price" numeric(12,2),
    "stock" bigint DEFAULT '0',
    "weight" numeric(10,3),
    "dimension" jsonb,
    "length" numeric(10,3),
    "width" numeric(10,3),
    "height" numeric(10,3),
    "attributes" jsonb,
    "images" jsonb,
    "image_urls" jsonb,
    "video1" character varying(1024),
    "video2" character varying(1024),
    "vendormrp" numeric(12,2),
    "vendorsaleprice" numeric(12,2),
    "ourmrp" numeric(12,2),
    "oursaleprice" numeric(12,2),
    "tax" jsonb,
    "tax1" numeric(8,2),
    "tax2" numeric(8,2),
    "tax3" numeric(8,2),
    "variant_color" character varying(128),
    "variant_size" character varying(128),
    "country_of_origin" character varying(128),
    "is_active" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variants_sku_key" UNIQUE ("sku")
) WITH (oids = false);

CREATE INDEX "idx_variants_price" ON "public"."product_variants" USING btree ("price");

CREATE INDEX "idx_variants_product_id" ON "public"."product_variants" USING btree ("product_id");

CREATE INDEX "idx_variants_sku" ON "public"."product_variants" USING btree ("sku");

CREATE INDEX "idx_variants_stock" ON "public"."product_variants" USING btree ("stock");

CREATE INDEX "idx_variants_variant_color" ON "public"."product_variants" USING btree ("variant_color");

CREATE INDEX "idx_variants_variant_size" ON "public"."product_variants" USING btree ("variant_size");


DROP TABLE IF EXISTS "products";
DROP SEQUENCE IF EXISTS products_pid_seq;
CREATE SEQUENCE products_pid_seq INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;

CREATE TABLE "public"."products" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "pid" bigint DEFAULT nextval('products_pid_seq') NOT NULL,
    "vendor_id" uuid,
    "productid" character varying(255),
    "product_sku" character varying(255),
    "productpartnersku" character varying(255),
    "name" character varying(512) NOT NULL,
    "title" character varying(512),
    "short_description" text,
    "description" text,
    "brand_name" character varying(255),
    "gender" character varying(50),
    "default_category_id" uuid,
    "attributes" jsonb,
    "product_meta" jsonb,
    "sizechart_text" text,
    "sizechart_image" character varying(1024),
    "shipping_returns_payments" jsonb,
    "environmental_impact" jsonb,
    "product_img" character varying(1024),
    "product_img1" character varying(1024),
    "product_img2" character varying(1024),
    "product_img3" character varying(1024),
    "product_img4" character varying(1024),
    "product_img5" character varying(1024),
    "videos" jsonb,
    "delivery_time" character varying(128),
    "cod_available" boolean DEFAULT false,
    "supplier" character varying(255),
    "country_of_origin" character varying(128),
    "is_active" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_product_sku_key" UNIQUE ("product_sku")
) WITH (oids = false);

CREATE INDEX "idx_products_brand" ON "public"."products" USING btree ("brand_name");

CREATE INDEX "idx_products_gender" ON "public"."products" USING btree ("gender");

CREATE INDEX "idx_products_is_active" ON "public"."products" USING btree ("is_active");

CREATE INDEX "idx_products_name" ON "public"."products" USING btree ("name");

CREATE INDEX "idx_products_productid" ON "public"."products" USING btree ("productid");

CREATE INDEX "idx_products_vendor_id" ON "public"."products" USING btree ("vendor_id");


DROP TABLE IF EXISTS "sales";
CREATE TABLE "public"."sales" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "product_id" uuid NOT NULL,
    "rank" integer,
    "meta" jsonb DEFAULT '{}',
    "discount_percent" numeric(5,2) DEFAULT '0',
    "active" boolean DEFAULT true,
    "start_at" timestamptz,
    "end_at" timestamptz,
    "created_by" uuid,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
) WITH (oids = false);


DROP TABLE IF EXISTS "users";
CREATE TABLE "public"."users" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "email" character varying(255) NOT NULL,
    "phone" character varying(150),
    "password_hash" text,
    "full_name" character varying(120),
    "magic_token" text,
    "magic_token_expires" timestamptz,
    "is_active" boolean DEFAULT true,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "users_email_key" UNIQUE ("email"),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_users_email" ON "public"."users" USING btree ("email");

CREATE INDEX "idx_users_is_active" ON "public"."users" USING btree ("is_active");

CREATE INDEX "idx_users_phone" ON "public"."users" USING btree ("phone");


DROP TABLE IF EXISTS "vendors";
CREATE TABLE "public"."vendors" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" character varying(255) NOT NULL,
    "slug" character varying(255),
    "contact_email" character varying(255),
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendors_slug_key" UNIQUE ("slug")
) WITH (oids = false);

CREATE INDEX "idx_vendors_slug" ON "public"."vendors" USING btree ("slug");


DROP TABLE IF EXISTS "wallet_transactions";
CREATE TABLE "public"."wallet_transactions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "wallet_id" uuid,
    "change" numeric(14,2),
    "type" character varying(100),
    "reference" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_wallet_tx_wallet_id" ON "public"."wallet_transactions" USING btree ("wallet_id");


DROP TABLE IF EXISTS "wallets";
CREATE TABLE "public"."wallets" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "balance" numeric(14,2) DEFAULT '0',
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "deleted_at" timestamptz,
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallets_user_id_key" UNIQUE ("user_id")
) WITH (oids = false);

CREATE INDEX "idx_wallets_user_id" ON "public"."wallets" USING btree ("user_id");


ALTER TABLE ONLY "public"."addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."best_sellers" ADD CONSTRAINT "best_sellers_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;
ALTER TABLE ONLY "public"."best_sellers" ADD CONSTRAINT "best_sellers_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES vendors(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE NOT DEFERRABLE;
ALTER TABLE ONLY "public"."cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL NOT DEFERRABLE;

ALTER TABLE ONLY "public"."inventory_transactions" ADD CONSTRAINT "inventory_transactions_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."magic_links" ADD CONSTRAINT "magic_links_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."media" ADD CONSTRAINT "media_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."new_arrivals" ADD CONSTRAINT "new_arrivals_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE NOT DEFERRABLE;
ALTER TABLE ONLY "public"."order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES product_variants(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) NOT DEFERRABLE;
ALTER TABLE ONLY "public"."orders" ADD CONSTRAINT "orders_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES vendors(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."product_categories" ADD CONSTRAINT "product_categories_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE NOT DEFERRABLE;
ALTER TABLE ONLY "public"."product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."product_dynamic_filters" ADD CONSTRAINT "product_dynamic_filters_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."products" ADD CONSTRAINT "products_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES vendors(id) NOT DEFERRABLE;

ALTER TABLE ONLY "public"."sales" ADD CONSTRAINT "sales_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) NOT DEFERRABLE;

-- 2025-10-25 00:50:08.595527+05:30