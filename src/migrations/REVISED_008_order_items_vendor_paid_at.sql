-- Track when we paid the vendor (for reference after paying on merchant dashboard)
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS vendor_paid_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN order_items.vendor_paid_at IS 'When the merchant marked this item as paid with the vendor (after paying on vendor dashboard).';
