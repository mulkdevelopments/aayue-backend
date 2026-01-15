// src/controllers/paymentController.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
console.log("Stripe initialized with key:", process.env.STRIPE_SECRET_KEY);
const dbPool = require("../../db/dbConnection");
const CartService = require("../../services/cartService"); // assume you have getCart, addItem, clearCart
const OrderService = require("../../services/orderService");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { CouponService } = require("../../services/couponService");
const {
  sendOrderConfirmation,
  sendInvoiceAttachmentEmail,
  sendNewOrderNotificationEmail,
} = require("../../utils/sendMail");
const puppeteer = require("puppeteer");
const path = require("path");
const { generateInvoiceHTML } = require("../../template/generateInvoiceHtml");
const fs = require("fs");
const { generateInvoicePDF } = require("../../utils/generateInvociePdf");

const { emailQueue, pdfQueue } = require("../../lib/queue");
// const sendInvoiceAttachmentEmail = require("../../utils/sendMail");
const { VendorOrderManager } = require("../../services/vendorOrders");

// module.exports.createCheckoutSession = catchAsync(async (req, res, next) => {
//     const client = await dbPool.connect();
//     try {
//         const user_id = req.user?.id;
//         if (!user_id) return next(new AppError('Unauthorized', 401));

//         console.log('createCheckoutSession request body:', req.body);
//         const { mode = 'cart', variant_id, qty = 1, shipping_address_id , couponId, couponCode} = req.body;

//         if (!shipping_address_id) {
//             return next(new AppError('shipping_address_id is required', 400));
//         }

//         // ✅ Fetch the shipping address from DB
//         const { rows: addrRows } = await client.query(
//             `SELECT id, label, street, city, state, postal_code, country, lat, lon, mobile
//        FROM addresses
//        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
//             [shipping_address_id, user_id]
//         );

//         if (addrRows.length === 0) {
//             return next(new AppError('Shipping address not found', 404));
//         }

//         const shipping_address = addrRows[0];

//         // Build items
//         let items = [];
//         if (mode === 'cart') {
//             const cart = await CartService.getCart({ user_id }, client);
//             // console.log('User cart for checkout:', cart);
//             items = cart.items || [];
//         } else if (mode === 'buy_now') {
//             if (!variant_id) return next(new AppError('variant_id required for buy_now', 400));
//             await CartService.addItem({ user_id, variant_id, qty }, client);
//             const freshCart = await CartService.getCart({ user_id }, client);
//             items = freshCart.items.filter(i => i.variant_id === variant_id);
//             if (items.length === 0) return next(new AppError('Variant not found after add', 400));
//         } else {
//             return next(new AppError('Invalid mode', 400));
//         }

//         if (!items || items.length === 0) return next(new AppError('No items to checkout', 400));

//         // compute total (use sale_price if present)
//         let totalAmount = 0;
//         for (const it of items) {
//             const unit = (it.sale_price !== undefined && it.sale_price !== null)
//                 ? Number(it.sale_price)
//                 : Number(it.price || 0);
//             totalAmount += unit * Number(it.qty || 1);
//         }
//         totalAmount = Number(totalAmount.toFixed(2));

//         // let couponDiscount = 0;
//         // if (couponId) {
//         //     const { rows: couponRows } = await client.query(
//         //         `SELECT * FROM coupons WHERE id = $1 AND deleted_at IS NULL`,
//         //         [couponId]
//         //     );
//         //     if (couponRows.length === 0) return next(new AppError('Coupon not found', 404));
//         //     let coupon = couponRows[0];
//         //     if(coupon.type === "PERCENT"){
//         //         couponDiscount = (Number(coupon.discount) / 100) * totalAmount;
//         //         if(couponDiscount > coupon.max_discount){
//         //             couponDiscount = Number(coupon.max_discount);
//         //             totalAmount = totalAmount - couponDiscount;
//         //         }
//         //         else{
//         //             totalAmount = totalAmount - couponDiscount;
//         //         }
//         //     }
//         //     if(coupon.type === "FLAT"){
//         //         couponDiscount = Number(coupon.discount);
//         //         totalAmount = totalAmount - couponDiscount;
//         //     }
//         // }

//         await client.query('BEGIN');

//         // ✅ create order
//         const order = await OrderService.createOrderFromItems(
//             {
//                 user_id,
//                 items,
//                 shipping_address, // now object from DB
//                 billing_address: shipping_address,
//                 vendor_id: items[0]?.vendorId || null,
//                 coupon_id: couponId || null,
//                 coupon_code: couponCode || null,
//             },
//             client
//         );

//         // Build Stripe line_items
//         const line_items = items.map(it => {
//             const unit = (it.sale_price !== undefined && it.sale_price !== null)
//                 ? Number(it.sale_price)
//                 : Number(it.price || 0);
//             const name = it.product?.name || it.name || 'Product';
//             const image = it.product?.product_img || it.product?.image;

//             return {
//                 price_data: {
//                     currency: process.env.CURRENCY || 'usd',
//                     product_data: { name, images: image ? [image] : [] },
//                     unit_amount: Math.round(unit * 100),
//                 },
//                 quantity: Number(it.qty || 1),
//             };
//         });

//         // Create Stripe session
//         // create stripe session
//         const session = await stripe.checkout.sessions.create({
//             payment_method_types: ['card'],
//             mode: 'payment',
//             line_items,
//             metadata: { order_id: order.id, user_id },
//             success_url: `${process.env.FRONTEND_URL}/success-payment?order_id=${order.id}`,
//             cancel_url: `${process.env.FRONTEND_URL}/checkout-cancelled`,
//         });

//         if (!session || !session.id) {
//             await client.query('ROLLBACK').catch(() => { });
//             return next(new AppError('Failed to create stripe session', 500));
//         }

//         // Persist stripe session id on the order (inside the same transaction)
//         await client.query(
//             `UPDATE orders SET stripe_session_id = $1 WHERE id = $2`,
//             [session.id, order.id]
//         );

//         // Optionally persist payment_intent id if available
//         // try {
//         //     const paymentIntentId = (session.payment_intent && typeof session.payment_intent === 'string')
//         //         ? session.payment_intent
//         //         : (session.payment_intent && session.payment_intent.id) || null;

//         //     if (paymentIntentId) {
//         //         // await client.query(`ALTER TABLE IF NOT EXISTS orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)`);
//         //         await client.query(
//         //             `UPDATE orders SET stripe_payment_intent = $1 WHERE id = $2`,
//         //             [paymentIntentId, order.id]
//         //         );
//         //     }
//         // } catch (e) {
//         //     // non fatal; don't block checkout just because the optional update failed
//         //     console.warn('Could not persist payment_intent id:', e.message || e);
//         // }

//         await client.query('COMMIT');

//         return sendResponse(res, 200, true, 'Stripe session created', {
//             id: session.id,
//             url: session.url
//         });

//     } catch (err) {
//         await client.query('ROLLBACK').catch(() => { });
//         console.error('createCheckoutSession error', err);
//         return next(new AppError(err.message || 'Failed to create stripe session', 500));
//     } finally {
//         client.release();
//     }
// });

module.exports.createCheckoutSession = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    let {
      mode = "cart",
      variant_id,
      qty = 1,
      shipping_address_id,
      couponId,
      couponCode,
      selectedCurrency = "EUR",
      exchangeRate = 1,
      currencySymbol = "€",
    } = req.body;

    // PKR is not supported by Stripe - fallback to EUR for payment processing
    // User still sees PKR prices on frontend, but payment is processed in EUR
    const displayCurrency = selectedCurrency;
    const displayCurrencySymbol = currencySymbol;
    const displayExchangeRate = exchangeRate;

    if (selectedCurrency === "PKR") {
      console.log("⚠️ PKR currency detected - processing payment in EUR");
      selectedCurrency = "EUR";
      exchangeRate = 1;
      currencySymbol = "€";
    }

    if (!shipping_address_id) {
      return next(new AppError("shipping_address_id is required", 400));
    }

    // ✅ Fetch the shipping address from DB
    const { rows: addrRows } = await client.query(
      `SELECT id, label, street, city, state, postal_code, country, lat, lon, mobile
       FROM addresses
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [shipping_address_id, user_id]
    );

    if (addrRows.length === 0) {
      return next(new AppError("Shipping address not found", 404));
    }

    const shipping_address = addrRows[0];

    // Build items
    let items = [];
    if (mode === "cart") {
      const cart = await CartService.getCart({ user_id }, client);
      // console.log('User cart for checkout:', cart);
      items = cart.items || [];
    } else if (mode === "buy_now") {
      if (!variant_id)
        return next(new AppError("variant_id required for buy_now", 400));
      await CartService.addItem({ user_id, variant_id, qty }, client);
      const freshCart = await CartService.getCart({ user_id }, client);
      items = freshCart.items.filter((i) => i.variant_id === variant_id);
      if (items.length === 0)
        return next(new AppError("Variant not found after add", 400));
    } else {
      return next(new AppError("Invalid mode", 400));
    }

    if (!items || items.length === 0)
      return next(new AppError("No items to checkout", 400));

    // compute total (use sale_price if present)
    let totalAmount = 0;
    for (const it of items) {
      const unit =
        it.sale_price !== undefined && it.sale_price !== null
          ? Number(it.sale_price)
          : Number(it.price || 0);
      totalAmount += unit * Number(it.qty || 1);
    }
    totalAmount = Number(totalAmount.toFixed(2));

    let couponVerification = null;
    let discountAmount = 0;
    let freeShipping = false;
    let appliedCouponCode = couponCode || null;
    let appliedCouponId = couponId || null;

    if (couponCode || couponId) {
      try {
        const verifyPayload = {
          code: couponCode || null,
          user_id,
          channel: req.body.channel || "WEB",
          subtotal: totalAmount,
          shipping_cost: Number(req.body.shipping_cost || 0),
          items,
        };

        const verifyRes = await CouponService.verifyAndApplyCoupon(
          client,
          verifyPayload
        );
        if (!verifyRes.success) {
          // reject checkout if coupon invalid — frontend should handle showing message
          return next(new AppError(verifyRes.message || "Coupon invalid", 400));
        }
        couponVerification = verifyRes.data;
        discountAmount = Number(couponVerification.discount || 0);
        freeShipping = Boolean(couponVerification.free_shipping);
        appliedCouponCode =
          couponVerification.coupon?.code || appliedCouponCode;
        // coupon id might not be returned by verify API — order service will resolve and re-check inside transaction
      } catch (e) {
        console.error("Coupon verify error", e);
        return next(
          new AppError(e.message || "Coupon verification failed", 400)
        );
      }
    }

    // effective shipping
    const shippingCostFromReq = Number(req.body.shipping_cost || 0);
    const effectiveShippingCost = freeShipping ? 0 : shippingCostFromReq;

    // final totals (server of truth)
    const subtotalBeforeDiscount = totalAmount;
    const discountToApply = Math.min(discountAmount, subtotalBeforeDiscount);
    const subtotalAfterDiscount = Math.max(
      0,
      subtotalBeforeDiscount - discountToApply
    );
    const finalTotalAmount = Number(
      (subtotalAfterDiscount + effectiveShippingCost).toFixed(2)
    );

    await client.query("BEGIN");

    // ✅ create order with currency information
    // Store display currency (what user sees) and payment currency (what Stripe processes)
    const order = await OrderService.createOrderFromItems(
      {
        user_id,
        items,
        shipping_address, // now object from DB
        billing_address: shipping_address,
        vendor_id: items[0]?.vendorId || null,
        coupon_id: appliedCouponId || null,
        coupon_code: appliedCouponCode || null,
        discount: discountToApply, // Discount amount applied (in EUR)
        currency: displayCurrency, // What user selected (EUR/AED/INR/PKR)
        exchange_rate: displayExchangeRate, // Exchange rate for display currency
        base_currency: "EUR",
        currency_symbol: displayCurrencySymbol,
      },
      client
    );

    // Build Stripe line_items with currency conversion
    // Note: Prices in DB are in EUR, we convert to selected currency
    const centsDiscount = Math.round(discountToApply * exchangeRate * 100);
    const itemLineCents = items.map((it) => {
      const eurUnit =
        it.sale_price !== undefined && it.sale_price !== null
          ? Number(it.sale_price)
          : Number(it.price || 0);
      const convertedUnit = eurUnit * exchangeRate;
      const qty = Number(it.qty || 1);
      return Math.round(convertedUnit * 100) * qty;
    });
    const subtotalCents = itemLineCents.reduce((a, b) => a + b, 0);
    const subtotalAfterDiscountCents = Math.max(
      0,
      subtotalCents - centsDiscount
    );

    let allocatedCents = 0;
    const adjustedLineItems = items.map((it, idx) => {
      const qty = Number(it.qty || 1);
      const originalLineCents = itemLineCents[idx];

      // proportion of subtotal this line represents
      const proportion =
        subtotalCents > 0 ? originalLineCents / subtotalCents : 0;

      // discount allocated to this line (floor to avoid fractional cents)
      let discountForLine = Math.floor(centsDiscount * proportion);

      // For the last item, assign leftover to match exactly
      if (idx === items.length - 1) {
        const alreadyAllocated = allocatedCents;
        const remaining = subtotalAfterDiscountCents - alreadyAllocated;
        // remaining is the total cents we should allocate to this line (after discount)
        // so adjustedLineTotalCents = remaining
        const adjustedLineTotalCents = remaining;
        const adjustedUnitCents = Math.max(
          0,
          Math.floor(adjustedLineTotalCents / qty)
        );
        allocatedCents += adjustedUnitCents * qty;
        const name = it.product?.name || it.name || "Product";
        const image = it.product?.product_img || it.product?.image || null;
        return {
          price_data: {
            currency: selectedCurrency.toLowerCase(),
            product_data: { name, images: image ? [image] : [] },
            unit_amount: adjustedUnitCents,
          },
          quantity: qty,
        };
      } else {
        // standard allocation
        const adjustedLineTotalCents = originalLineCents - discountForLine;
        const adjustedUnitCents = Math.max(
          0,
          Math.floor(adjustedLineTotalCents / qty)
        );
        allocatedCents += adjustedUnitCents * qty;
        const name = it.product?.name || it.name || "Product";
        const image = it.product?.product_img || it.product?.image || null;
        return {
          price_data: {
            currency: selectedCurrency.toLowerCase(),
            product_data: { name, images: image ? [image] : [] },
            unit_amount: adjustedUnitCents,
          },
          quantity: qty,
        };
      }
    });

    // Optionally: if you want shipping as a stripe line item (recommended if you show shipping) add it:
    if (effectiveShippingCost > 0) {
      const shippingInSelectedCurrency = effectiveShippingCost * exchangeRate;
      adjustedLineItems.push({
        price_data: {
          currency: selectedCurrency.toLowerCase(),
          product_data: { name: "Shipping" },
          unit_amount: Math.round(shippingInSelectedCurrency * 100),
        },
        quantity: 1,
      });
    }

    // Create Stripe session with adjustedLineItems
    // Google Pay is already enabled in your Stripe dashboard and works automatically
    // UPI-specific payment methods require additional setup in India
    const paymentMethods = ["card"];

    // Add additional payment methods based on currency
    // Google Pay will automatically show for supported currencies when enabled

    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethods,
      mode: "payment",
      line_items: adjustedLineItems,
      metadata: {
        order_id: order.id,
        user_id,
        currency: selectedCurrency,
        exchange_rate: exchangeRate.toString(),
      },
      success_url: `${process.env.FRONTEND_URL}/success-payment?order_id=${order.id}`,
      cancel_url: `${process.env.FRONTEND_URL}/checkout-cancelled`,
    });

    if (!session || !session.id) {
      await client.query("ROLLBACK").catch(() => {});
      return next(new AppError("Failed to create stripe session", 500));
    }

    // Persist stripe session id on the order (inside the same transaction)
    await client.query(
      `UPDATE orders SET stripe_session_id = $1 WHERE id = $2`,
      [session.id, order.id]
    );

    // Optionally persist payment_intent id if available
    // try {
    //     const paymentIntentId = (session.payment_intent && typeof session.payment_intent === 'string')
    //         ? session.payment_intent
    //         : (session.payment_intent && session.payment_intent.id) || null;

    //     if (paymentIntentId) {
    //         // await client.query(`ALTER TABLE IF NOT EXISTS orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)`);
    //         await client.query(
    //             `UPDATE orders SET stripe_payment_intent = $1 WHERE id = $2`,
    //             [paymentIntentId, order.id]
    //         );
    //     }
    // } catch (e) {
    //     // non fatal; don't block checkout just because the optional update failed
    //     console.warn('Could not persist payment_intent id:', e.message || e);
    // }

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Stripe session created", {
      id: session.id,
      url: session.url,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("createCheckoutSession error", err);
    return next(
      new AppError(err.message || "Failed to create stripe session", 500)
    );
  } finally {
    client.release();
  }
});

/**
 * Stripe webhook endpoint
 * NOTE: this handler expects raw body (express.raw) and uses STRIPE_WEBHOOK_SECRET
 */
module.exports.stripeWebhookHandler = catchAsync(async (req, res, next) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // req.rawBody must be raw buffer (see route setup)
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const order_id = session.metadata?.order_id;
    const payment_intent =
      session.payment_intent || session.payment_intent_id || null;

    // finalize the order: mark paid, decrement stock (idempotent)
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const finalizeRes = await OrderService.finalizePaidOrder(
        { order_id, payment_id: payment_intent },
        client
      );
      await client.query("COMMIT");

      // Optional: clear user's cart (if you used cart flow). We'll attempt but ignore errors.
      // You can implement CartService.clearCart({user_id}, client) if desired.
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Failed to finalize paid order", err);
    } finally {
      client.release();
    }
  }

  // respond to Stripe
  res.json({ received: true });
});

module.exports.verifyPayment = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const { session_id, payment_intent, order_id } = req.body;
    if (!order_id && !session_id && !payment_intent) {
      return next(
        new AppError("Provide order_id or session_id or payment_intent", 400)
      );
    }

    // --------------------------------------------
    // 🧩 STEP 1: Fetch the order & stripe session ID (if missing)
    // --------------------------------------------
    const { rows: orderRows } = await client.query(
      `SELECT id, user_id, stripe_session_id
       FROM orders
       WHERE id = $1 AND deleted_at IS NULL`,
      [order_id]
    );

    if (orderRows.length === 0)
      return next(new AppError("Order not found", 404));

    const order = orderRows[0];
    if (String(order.user_id) !== String(user_id)) {
      return next(new AppError("Order does not belong to current user", 403));
    }

    // Prefer body session_id, else take from DB
    const sessionIdToUse = session_id || order.stripe_session_id || null;

    if (!sessionIdToUse && !payment_intent) {
      return next(new AppError("Stripe session not found for this order", 400));
    }

    // --------------------------------------------
    // 🧩 STEP 2: Retrieve Stripe Session or PaymentIntent
    // --------------------------------------------
    let stripePaymentId = null;
    let stripeStatus = null;
    let metadata = {};
    let session = null;

    if (sessionIdToUse) {
      session = await stripe.checkout.sessions.retrieve(sessionIdToUse, {
        expand: [
          "payment_intent",
          "payment_intent.charges",
          "payment_intent.charges.data.payment_method_details",
          "payment_intent.payment_method",
        ],
      });

      // console.log("Retrieved Stripe session:========", session);
      const card = session.payment_intent.payment_method.card;

      // console.log("Retrieved Stripe session:========", session);
      if (!session) return next(new AppError("Stripe session not found", 404));

      if (
        session.payment_intent &&
        typeof session.payment_intent === "object"
      ) {
        stripePaymentId = session.payment_intent.id;
        stripeStatus = session.payment_intent.status;
      } else if (session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        stripePaymentId = pi.id;
        stripeStatus = pi.status;
      } else {
        stripeStatus = session.payment_status || null;
      }

      metadata = session.metadata || {};
    } else if (payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(payment_intent);
      if (!pi) return next(new AppError("Payment intent not found", 404));
      stripePaymentId = pi.id;
      stripeStatus = pi.status;
      metadata = pi.metadata || {};
    }

    // --------------------------------------------
    // 💾 STEP 2.5: Save or Update Payment Details
    // --------------------------------------------
    try {
      const paymentIntentObj =
        sessionIdToUse && typeof session?.payment_intent === "object"
          ? session.payment_intent
          : payment_intent
          ? await stripe.paymentIntents.retrieve(payment_intent)
          : null;

      const charge = paymentIntentObj?.charges?.data?.[0];
      const chargeId = charge?.id || paymentIntentObj?.latest_charge || null;

      // Generate a user-facing transaction reference
      const transactionRef = `TXN-${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14)}`;

      // ✅ Upsert into payments table
      await client.query(
        `
    INSERT INTO payments (
      order_id, amount, method, status,
      stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
      transaction_reference, currency, card_brand, card_last4,
      receipt_url, provider_response, metadata, paid_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
    ON CONFLICT (order_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      stripe_session_id = EXCLUDED.stripe_session_id,
      stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
      stripe_charge_id = EXCLUDED.stripe_charge_id,
      transaction_reference = EXCLUDED.transaction_reference,
      currency = EXCLUDED.currency,
      card_brand = EXCLUDED.card_brand,
      card_last4 = EXCLUDED.card_last4,
      receipt_url = EXCLUDED.receipt_url,
      provider_response = EXCLUDED.provider_response,
      metadata = EXCLUDED.metadata,
      paid_at = NOW()
    `,
        [
          order_id,
          paymentIntentObj?.amount / 100 || 0, // Stripe amount is in smallest unit
          "stripe",
          paymentIntentObj?.status || "succeeded",
          sessionIdToUse,
          paymentIntentObj?.id,
          chargeId,
          transactionRef,
          paymentIntentObj?.currency || "aed",
          charge?.payment_method_details?.card?.brand || null,
          charge?.payment_method_details?.card?.last4 || null,
          charge?.receipt_url || null,
          paymentIntentObj,
          paymentIntentObj?.metadata || {},
        ]
      );
    } catch (saveErr) {
      console.error("⚠️ Failed to save payment details:", saveErr.message);
    }

    // --------------------------------------------
    // 🧩 STEP 3: Verify payment success
    // --------------------------------------------
    const paidStatuses = new Set(["succeeded", "requires_capture"]);
    if (!stripeStatus || !paidStatuses.has(stripeStatus)) {
      return next(
        new AppError(
          `Payment not completed. Stripe status: ${stripeStatus}`,
          400
        )
      );
    }

    // --------------------------------------------
    // 🧩 STEP 4: Finalize order in DB
    // --------------------------------------------
    await client.query("BEGIN");

    const finalizeRes = await OrderService.finalizePaidOrder(
      { order_id, payment_id: stripePaymentId },
      client
    );

    // Optionally clear the cart if user used “cart” mode
    try {
      await CartService.clearCart({ user_id }, client);
    } catch (e) {
      console.warn(
        "Failed to clear cart after payment verification:",
        e.message
      );
    }

    await client.query("COMMIT");

    // --------------------------------------------
    // 🧩 STEP 5: Send Order Confirmation Email
    // --------------------------------------------
    let orderItems;
    let user;

    try {

      const { rows: userRows } = await client.query(
        `SELECT full_name, email FROM users
         WHERE id = $1`,
        [user_id]
      );
      user = userRows[0];

      const { rows } = await client.query(
        `
  SELECT
    p.name AS name,
    p.product_img AS image,
    oi.qty,
    oi.price,
    oi.order_id,
    o.order_no,
    o.payment_status,
    o.billing_address,
    o.shipping_address,
    o.currency,
    o.currency_symbol,
    o.exchange_rate,
    pv.sku,
    pv.normalized_size AS size
  FROM order_items oi
  JOIN product_variants pv ON pv.id = oi.variant_id
  JOIN products p ON p.id = pv.product_id
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.order_id = $1
  `,
        [order_id]
      );

      orderItems = [...rows];
      if (user && orderItems.length > 0) {
        await emailQueue.add("sendCustomerEmail", {
          to: user.email,
          orderData: {
            customerName: user.full_name,
            orderId: orderItems[0]?.order_no || order_id,
            items: orderItems,
            payment_id: stripePaymentId,
            currency: orderItems[0]?.currency_symbol || "€",
          },
        });
      }
      // try {
      //   const adminEmails = await client
      //     .query(
      //       `SELECT email FROM admins WHERE role = 'superadmin' AND deleted_at IS NULL`
      //     )
      //     .then((result) => result.rows.map((row) => row.email));
      //   await emailQueue.add("sendAdminEmail", {
      //     toList: adminEmails,
      //     orderData: {
      //       customerName: user.full_name,
      //       customerEmail: user.email,
      //       customerPhone: user.phone || "N/A",
      //       orderId: orderItems[0]?.order_no || order_id,
      //       items: orderItems,
      //       total: orderItems.reduce(
      //         (acc, item) => acc + item.price * item.qty,
      //         0
      //       ),
      //       currency: orderItems[0]?.currency_symbol || "€",
      //     },
      //   });
      // } catch (adminErr) {
      //   console.error("⚠️ Failed to send admin new order email:", adminErr);
      // }
    } catch (mailErr) {
      console.error("Failed to send order confirmation email:", mailErr);
    }

    // --------------------------------------------
    // 🧩 STEP 6: Place Orders with Vendors (Async)
    // --------------------------------------------
    // Don't await - let vendor orders process in background
    // This prevents blocking customer response if vendor API is slow
    VendorOrderManager.placeOrderItems(order_id)
      .then((result) => {
        console.log("✅ Vendor order placement completed:", result.summary);
        // TODO: If any vendor failed, send notification to admin
        if (result.summary.failCount > 0) {
          console.error(`⚠️ ${result.summary.failCount} vendor(s) failed for order ${orderItems[0]?.order_no}`);
          // TODO: Send alert to admin
        }
      })
      .catch((error) => {
        console.error("❌ Vendor order placement error:", error.message);
        // Error is logged, admin can retry from dashboard
        // Customer already has order confirmation, so we don't fail here
      });

    // --------------------------------------------
    // 🧩 STEP 7: Generate Invoice PDF
    // --------------------------------------------
    // try {
    //   const invoiceData = {
    //     orderId: orderItems[0]?.order_no || order_id,
    //     orderDate: new Date().toLocaleDateString("en-IN", {
    //       day: "2-digit",
    //       month: "2-digit",
    //       year: "numeric",
    //     }),
    //     invoiceStatus: "PAID",
    //     paymentStatus: orderItems[0]?.payment_status || "Paid",
    //     subtotal: orderItems
    //       .reduce((acc, item) => acc + item.price * item.qty, 0)
    //       .toFixed(2),
    //     shipping: "0.00",
    //     grandTotal: orderItems
    //       .reduce((acc, item) => acc + item.price * item.qty, 0)
    //       .toFixed(2),

    //     company: {
    //       name: "FTVAAYEU",
    //       address:
    //         "Office 304, Al Saqr Tower Sheikh Zayed Road, Trade Centre 1 Dubai",
    //       email: "help@aayeu.com",
    //       phone: "+971-50-1234567",
    //       logo: "https://yourdomain.com/files/logo.png",
    //     },

    //     customer: {
    //       name: user.full_name,
    //       address: orderItems[0]?.billing_address, // You can fetch from 'orders' if you store it there
    //       email: user.email,
    //       phone: "N/A",
    //     },
    //     items: orderItems.map((item) => ({
    //       sku: item.sku || item.order_id,
    //       product_name: item.name,
    //       size: item.size || "-",
    //       qty: item.qty,
    //       unitPrice: Number(item.price).toFixed(2),
    //       total: (Number(item.price) * item.qty).toFixed(2),
    //     })),
    //   };

    //   const invoiceHTML = generateInvoiceHTML(invoiceData);

    //   try {
    //     await emailQueue.add("sendInvoiceEmail", {
    //       to: user.email,
    //       customerName: user.full_name,
    //       invoiceHTML: invoiceHTML,
    //       orderId: order_id,
    //       orderNo: orderItems[0]?.order_no,
    //     });
    //   } catch (mailErr) {
    //     // Non-fatal: log and continue
    //     console.error(
    //       "⚠️ Failed to send invoice attachment email:",
    //       mailErr.message || mailErr
    //     );
    //   }
    // } catch (pdfErr) {
    //   console.error("❌ Failed to generate invoice PDF:", pdfErr);
    // }

    return sendResponse(
      res,
      200,
      true,
      "Payment verified and order finalized",
      {
        order_id,
        order_no: orderItems[0]?.order_no || order_id,
        payment_id: stripePaymentId,
        status: stripeStatus,
        finalize: finalizeRes,
      }
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("verifyPayment error:", err);
    return next(new AppError(err.message || "Failed to verify payment", 500));
  } finally {
    client.release();
  }
});
