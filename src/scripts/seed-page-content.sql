-- Seed FAQ (sections) and How-to-Shop content. Replaces any existing faq content.
-- Usage: psql -U your_user -d your_db -f src/scripts/seed-page-content.sql

-- FAQ: new sections structure (1. About AAYEU, 1.1, 1.2, etc.) — same as migrate_faq_to_sections.sql
INSERT INTO page_content (key, content, updated_at)
VALUES (
  'faq',
  '{
  "intro_text": "Find quick answers to common questions. Need more help? Reach out via the Contact Us page or email our support team.",
  "contact_email": "help@aayeu.com",
  "sections": [
    {"title": "About AAYEU", "items": [{"question": "What is AAYEU?", "answer": "AAYEU is an online luxury fashion platform offering carefully selected designer clothing and accessories from international brands. Every product is chosen for its quality, craftsmanship, and timeless appeal."}, {"question": "Are all products authentic?", "answer": "Yes. All items sold on AAYEU are 100% authentic."}]},
    {"title": "Account & Registration", "items": [{"question": "Do I need an account to shop on AAYEU?", "answer": "Yes. Creating an account is required to place an order. Your account helps you track orders, receive updates."}, {"question": "Why do I need to create an account?", "answer": "An account allows us to process payments securely, ensure accurate delivery, and provide proper order support for international shipments."}, {"question": "How do I create an account?", "answer": "Click on Sign Up, enter your details, verify your email, and you''re ready to shop."}]},
    {"title": "Shopping & Orders", "items": [{"question": "How do I place an order?", "answer": "Once logged in, browse our collections, select your size, add items to your cart, and complete checkout. Your order is confirmed after successful payment."}, {"question": "When is my order processed?", "answer": "Orders are usually processed within 1–3 business days after payment confirmation."}, {"question": "Can I cancel or change my order?", "answer": "Orders can only be cancelled before processing begins. Once processing starts, changes are not possible."}, {"question": "What if an item becomes unavailable after I order?", "answer": "If an item cannot be fulfilled, your order will be cancelled, and a full refund will be issued."}]},
    {"title": "Shipping & Delivery", "items": [{"question": "How long does delivery take?", "answer": "Estimated delivery times are:\n• 7–10 business days\n\nDelivery times are estimates and may vary due to customs clearance or courier delays."}, {"question": "Will I receive tracking information?", "answer": "Yes. Tracking details are shared once your order is dispatched."}, {"question": "Are customs duties and taxes included?", "answer": "All customs duties, VAT, or import taxes (if applicable) are included in the price."}]},
    {"title": "Payments", "items": [{"question": "What payment methods do you accept?", "answer": "We accept major credit and debit cards, and other secure online payment options shown at checkout."}, {"question": "Are all orders prepaid?", "answer": "Yes. All orders must be paid in full before processing."}, {"question": "In which currency will I be charged?", "answer": "Prices may be shown in local currency for convenience. However, the final charge currency depends on your payment provider or bank, and conversion rates may apply."}, {"question": "What if my payment fails or is charged twice?", "answer": "Failed payments are not charged. If a duplicate charge occurs, it will be refunded within 7–10 business days."}]},
    {"title": "Returns & Refunds", "items": [{"question": "Do you accept returns?", "answer": "Yes, returns are accepted in accordance with our return policy and terms and conditions.\n\nYou may request a return within 7 days of delivery if:\n• The item is defective\n• The wrong item was delivered\n• The item was damaged during transit\n\nReturns for change of mind, size, colour, or personal preference are not accepted."}, {"question": "How do I request a return?", "answer": "Email refunds@aayeu.com within 7 days of delivery with clear images or videos of the issue."}, {"question": "What condition must returned items be in?", "answer": "Items must be unused, with original tags and packaging, and must pass our inspection."}, {"question": "How long does the refund take?", "answer": "Once approved, refunds are processed within 10–14 business days to the original payment method."}, {"question": "Are shipping and customs charges refundable?", "answer": "No. Shipping fees, customs duties, and taxes are non-refundable."}, {"question": "Which items cannot be returned?", "answer": "• Final sale items\n• Customised or special-order products\n• Items marked as non-returnable on the product page"}]},
    {"title": "Product Information & Sizing", "items": [{"question": "How do I choose the right size?", "answer": "Each product page includes a size guide to help you choose the best fit. We recommend reviewing measurements carefully before placing your order."}]},
    {"title": "Customer Support", "items": [{"question": "How can I contact AAYEU?", "answer": "For help with orders, deliveries, or returns, reach out to us through the Contact Us page and email our support team.\n\nWe''re here to make your shopping experience easy and stress-free."}]}
  ]
}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW();

-- How-to-Shop: title, subtitle, intro_text, steps
INSERT INTO page_content (key, content, updated_at)
VALUES (
  'how_to_shop',
  '{
    "title": "How to Shop on AAYEU",
    "subtitle": "A Simple, Seamless Luxury Shopping Experience",
    "intro_text": "Shopping on AAYEU is designed to be effortless, refined, and transparent. From discovering luxury fashion to placing your order, every step is simple and customer focused.\n\nFollow the steps below to enjoy a smooth and confident shopping journey.",
    "steps": [
      {"title": "1. Explore Our Curated Collections", "text": "Browse our carefully selected range of luxury fashion and accessories. Each piece is chosen for its quality, craftsmanship, and timeless style, so you''re shopping from collections that truly matter."},
      {"title": "2. Select Your Item", "text": "Click on any product to view detailed descriptions, high-quality images, available sizes, and pricing.\n\nIf you''re unsure about sizing, we''ve made it easy:\n• Refer to our Size Guide available on each product page\n• Compare measurements to find the best fit for you\n• Take your time reviewing all details before adding the item to your cart"},
      {"title": "3. Add to Cart", "text": "Once you''ve selected your preferred size, add the item to your cart. You can continue browsing our collections or proceed to checkout whenever you''re ready."},
      {"title": "4. Secure Checkout", "text": "At checkout, review your selected items, enter your shipping details, and complete your purchase using our secure payment process.\n\nAll prices, taxes, and applicable charges are clearly displayed."},
      {"title": "5. Order Confirmation", "text": "After placing your order, you''ll receive a confirmation email with all your purchase details. This confirms that your order has been successfully placed and is being prepared with care."},
      {"title": "6. Delivery", "text": "Your order will be carefully packaged and shipped to your chosen destination.\n\n• Tracking and delivery details are shared following shipment."},
      {"title": "7. Need Help?", "text": "If you need assistance at any point — placing an order or tracking your delivery — our customer support team is here for you.\n\n📧 help@aayeu.com\n\nWe''re always happy to help make your shopping experience effortless."}
    ]
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW();
