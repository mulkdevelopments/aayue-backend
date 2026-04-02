-- Admins who have this flag set to true will receive an email when a new order is placed.
-- Default false: no one receives order emails until opted in.
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS receive_order_notifications BOOLEAN DEFAULT false;

COMMENT ON COLUMN admins.receive_order_notifications IS 'When true, this admin receives new order notification emails.';

CREATE INDEX IF NOT EXISTS idx_admins_receive_order_notifications
ON admins(receive_order_notifications)
WHERE receive_order_notifications = true;
