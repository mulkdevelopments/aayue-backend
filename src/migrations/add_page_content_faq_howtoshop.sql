-- Store editable FAQ and How-to-shop page content (keyed by page).
CREATE TABLE IF NOT EXISTS page_content (
  key TEXT PRIMARY KEY,
  content JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE page_content IS 'Editable static page content: faq, how_to_shop.';

-- FAQ content: use migrate_faq_to_sections.sql (sections structure 1. About AAYEU, 1.1, 1.2, etc.).

-- Default How-to-shop content (How to Shop on AAYEU, 7 steps)
INSERT INTO page_content (key, content)
VALUES (
  'how_to_shop',
  '{"title": "How to Shop on AAYEU", "subtitle": "A Simple, Seamless Luxury Shopping Experience", "intro_text": "Shopping on AAYEU is designed to be effortless, refined, and transparent. From discovering luxury fashion to placing your order, every step is simple and customer focused.\n\nFollow the steps below to enjoy a smooth and confident shopping journey.", "steps": [
    {"title": "1. Explore Our Curated Collections", "text": "Browse our carefully selected range of luxury fashion and accessories. Each piece is chosen for its quality, craftsmanship, and timeless style, so you''re shopping from collections that truly matter."},
    {"title": "2. Select Your Item", "text": "Click on any product to view detailed descriptions, high-quality images, available sizes, and pricing.\n\nIf you''re unsure about sizing, we''ve made it easy:\n• Refer to our Size Guide available on each product page\n• Compare measurements to find the best fit for you\n• Take your time reviewing all details before adding the item to your cart"},
    {"title": "3. Add to Cart", "text": "Once you''ve selected your preferred size, add the item to your cart. You can continue browsing our collections or proceed to checkout whenever you''re ready."},
    {"title": "4. Secure Checkout", "text": "At checkout, review your selected items, enter your shipping details, and complete your purchase using our secure payment process.\n\nAll prices, taxes, and applicable charges are clearly displayed."},
    {"title": "5. Order Confirmation", "text": "After placing your order, you''ll receive a confirmation email with all your purchase details. This confirms that your order has been successfully placed and is being prepared with care."},
    {"title": "6. Delivery", "text": "Your order will be carefully packaged and shipped to your chosen destination.\n\n• Tracking and delivery details are shared following shipment."},
    {"title": "7. Need Help?", "text": "If you need assistance at any point — placing an order or tracking your delivery — our customer support team is here for you.\n\n📧 help@aayeu.com\n\nWe''re always happy to help make your shopping experience effortless."}
  ]}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
