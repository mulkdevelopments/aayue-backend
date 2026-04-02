-- Category menu image (nav mega menu): admin can set per category
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT;
