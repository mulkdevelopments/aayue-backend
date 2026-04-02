// controllers/adminController/orderAdminController.js
const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const OrderAdminService = require("../../services/orderAdminService");
const { isValidUUID } = require("../../utils/basicValidation");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const { sendOrderStatusEmail } = require("../../utils/sendMail");
const { getCustomDutyForCurrency } = require("../../utils/customDutyHelper");
const { UserServices } = require("../../services/userServices");
const Stripe = require("stripe");
const OrderService = require("../../services/orderService");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * GET /admin/orders
 * Query params:
 *  - page, limit
 *  - status (payment_status or order_status filtering - optional)
 *  - payment_status
 *  - order_status
 *  - vendor_id
 *  - user_id
 *  - from_date, to_date (ISO strings)
 *  - q -> search order_no
 */
module.exports.listOrders = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      page = "1",
      limit = "50",
      payment_status,
      order_status,
      vendor_id,
      user_id,
      from_date,
      to_date,
      q,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // basic uuid validation if provided
    if (vendor_id && !isValidUUID(vendor_id))
      return next(new AppError("Invalid vendor_id", 400));
    if (user_id && !isValidUUID(user_id))
      return next(new AppError("Invalid user_id", 400));

    const options = {
      page: pageNum,
      limit: limitNum,
      offset,
      payment_status: payment_status || null,
      order_status: order_status || null,
      vendor_id: vendor_id || null,
      user_id: user_id || null,
      from_date: from_date || null,
      to_date: to_date || null,
      q: q || null,
    };

    const { total, orders } = await OrderAdminService.listOrders(
      options,
      client
    );

    const total_pages = Math.max(1, Math.ceil(total / limitNum));
    return sendResponse(res, 200, true, "Orders fetched", {
      total,
      page: pageNum,
      limit: limitNum,
      total_pages,
      orders,
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.listOrdersDashboard = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      page = "1",
      limit = "10",
      payment_status,
      order_status,
      vendor_id,
      user_id,
      from_date,
      to_date,
      q,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // basic uuid validation if provided
    if (vendor_id && !isValidUUID(vendor_id))
      return next(new AppError("Invalid vendor_id", 400));
    if (user_id && !isValidUUID(user_id))
      return next(new AppError("Invalid user_id", 400));

    const options = {
      page: pageNum,
      limit: limitNum,
      offset,
      payment_status: payment_status || null,
      order_status: order_status || null,
      vendor_id: vendor_id || null,
      user_id: user_id || null,
      from_date: from_date || null,
      to_date: to_date || null,
      q: q || null,
    };

    const { total, orders } = await OrderAdminService.listOrdersDashboard(
      options,
      client
    );

    const total_pages = Math.max(1, Math.ceil(total / limitNum));
    return sendResponse(res, 200, true, "Orders fetched", {
      total,
      page: pageNum,
      limit: limitNum,
      total_pages,
      orders,
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /admin/orders/:id
 * Returns full order details for admin
 */
module.exports.getOrderDetails = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.query.orderId;
    if (!isValidUUID(id)) return next(new AppError("Invalid order id", 400));

    const order = await OrderAdminService.getOrderById(id, client);
    if (!order) return next(new AppError("Order not found", 404));

    return sendResponse(res, 200, true, "Order details fetched", order);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * PATCH /admin/orders/:id/status
 * Body: { order_status: "shipped" } or { payment_status: "paid" } or both
 */
module.exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.body.orderId;
    const { order_status, payment_status, note } = req.body;

    console.log("Updating order status for:", id, order_status, payment_status);

    if (!isValidUUID(id)) return next(new AppError("Invalid order id", 400));
    if (!order_status && !payment_status)
      return next(
        new AppError("Provide order_status or payment_status to update", 400)
      );
    if (
      !["pending", "processing", "shipped", "delivered", "cancelled"].includes(
        order_status
      ) &&
      order_status
    ) {
      return next(new AppError("Invalid order_status", 400));
    }

    if (
      !["pending", "paid", "failed"].includes(payment_status) &&
      payment_status
    ) {
      return next(new AppError("Invalid payment_status", 400));
    }

    // const order = await OrderAdminService.getOrderById(id, client);
    // if (!order) return next(new AppError("Order not found", 404));
    // // console.log("Updating order:", order);

    // const user = await UserServices.findUserById(order.user_id, client);
    // if (!user) return next(new AppError("User not found", 404));

    let orderItems = [];
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
    o.exchange_rate,
    o.currency_symbol,
    pv.sku,
    pv.normalized_size AS size,
    u.full_name,
    u.email
  FROM order_items oi
  JOIN product_variants pv ON pv.id = oi.variant_id
  JOIN products p ON p.id = pv.product_id
  JOIN orders o ON o.id = oi.order_id
  JOIN users u ON u.id = o.user_id
  WHERE oi.order_id = $1
  `,
      [id]
    );

    orderItems = [...rows];

    const orderCurrency = orderItems[0]?.currency || "AED";
    const dutyPercent = await getCustomDutyForCurrency(client, orderCurrency);

    sendOrderStatusEmail(orderItems[0].email, {
      customerName: orderItems[0].full_name,
      orderId: orderItems[0].order_no,
      items: orderItems,
      status: order_status,
      currency: orderItems[0]?.currency_symbol || "€",
      exchange_rate: orderItems[0]?.exchange_rate != null ? Number(orderItems[0].exchange_rate) : 1,
      duty_percent: dutyPercent,
    });

    await client.query("BEGIN");
    const updated = await OrderAdminService.updateOrderStatus(
      { order_id: id, order_status, payment_status, note },
      client
    );
    await client.query("COMMIT");

    // sendOrderStatusEmail()

    return sendResponse(res, 200, true, "Order updated", updated);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /admin/verify-payment
 * Body: { orderId, session_id?, payment_intent? }
 * Manually verify payment with Stripe and finalize order if paid.
 */
module.exports.verifyOrderPayment = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { orderId, session_id, payment_intent } = req.body;

    if (!orderId && !session_id && !payment_intent) {
      return next(
        new AppError("Provide orderId or session_id or payment_intent", 400)
      );
    }

    if (orderId && !isValidUUID(orderId)) {
      return next(new AppError("Invalid order id", 400));
    }

    let sessionIdToUse = session_id || null;
    if (orderId) {
      const { rows: orderRows } = await client.query(
        `SELECT id, stripe_session_id
         FROM orders
         WHERE id = $1 AND deleted_at IS NULL`,
        [orderId]
      );
      if (orderRows.length === 0)
        return next(new AppError("Order not found", 404));

      const order = orderRows[0];
      if (!sessionIdToUse) sessionIdToUse = order.stripe_session_id || null;
    }

    if (!sessionIdToUse && !payment_intent) {
      return next(new AppError("Stripe session not found for this order", 400));
    }

    let stripePaymentId = null;
    let stripeStatus = null;
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
    } else if (payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(payment_intent);
      if (!pi) return next(new AppError("Payment intent not found", 404));
      stripePaymentId = pi.id;
      stripeStatus = pi.status;
    }

    const paidStatuses = new Set(["succeeded", "requires_capture"]);
    if (!stripeStatus || !paidStatuses.has(stripeStatus)) {
      return next(
        new AppError(
          `Payment not completed. Stripe status: ${stripeStatus}`,
          400
        )
      );
    }

    // PaymentIntent stays "succeeded" after a full refund — do not re-finalize as paid.
    const paymentIntentForRefund =
      sessionIdToUse && typeof session?.payment_intent === "object"
        ? session.payment_intent
        : stripePaymentId
        ? await stripe.paymentIntents.retrieve(stripePaymentId)
        : null;

    if (orderId && paymentIntentForRefund?.id) {
      const received =
        typeof paymentIntentForRefund.amount_received === "number"
          ? paymentIntentForRefund.amount_received
          : paymentIntentForRefund.amount || 0;
      const refundList = await stripe.refunds.list({
        payment_intent: paymentIntentForRefund.id,
        limit: 100,
      });
      const refundedCents = refundList.data
        .filter((r) => r.status === "succeeded")
        .reduce((s, r) => s + (r.amount || 0), 0);
      const fullyRefunded = received > 0 && refundedCents >= received;

      if (fullyRefunded) {
        let lastOrderRow = null;
        await client.query("BEGIN");
        try {
          await client.query(
            `UPDATE payments SET status = 'refunded' WHERE order_id = $1`,
            [orderId]
          );
          const { rows: oRows } = await client.query(
            `SELECT order_status, payment_status FROM orders WHERE id = $1 FOR UPDATE`,
            [orderId]
          );
          lastOrderRow = oRows[0] || null;
          if (
            lastOrderRow &&
            String(lastOrderRow.order_status || "").toLowerCase() ===
              "cancelled"
          ) {
            await client.query(
              `UPDATE orders SET payment_status = 'refund_completed', deleted_at = NULL WHERE id = $1`,
              [orderId]
            );
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        }
        const msg =
          lastOrderRow &&
          String(lastOrderRow.order_status || "").toLowerCase() === "cancelled"
            ? "Stripe confirms full refund. Order remains cancelled with refund completed."
            : "Stripe shows this payment was fully refunded. Payment record updated.";
        return sendResponse(res, 200, true, msg, {
          order_id: orderId,
          payment_status:
            lastOrderRow &&
            String(lastOrderRow.order_status || "").toLowerCase() ===
              "cancelled"
              ? "refund_completed"
              : lastOrderRow?.payment_status,
          refunded_in_stripe: true,
        });
      }
    }

    await client.query("BEGIN");

    try {
      const paymentIntentObj =
        sessionIdToUse && typeof session?.payment_intent === "object"
          ? session.payment_intent
          : payment_intent
          ? await stripe.paymentIntents.retrieve(payment_intent)
          : paymentIntentForRefund;

      const charge = paymentIntentObj?.charges?.data?.[0];
      const chargeId = charge?.id || paymentIntentObj?.latest_charge || null;

      const transactionRef = `TXN-${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14)}`;

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
          orderId,
          paymentIntentObj?.amount / 100 || 0,
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

    const finalizeRes = await OrderService.finalizePaidOrder(
      { order_id: orderId, payment_id: stripePaymentId },
      client
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Payment verified", {
      order_id: orderId,
      payment_status: "paid",
      payment_id: stripePaymentId,
      result: finalizeRes,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(err);
  } finally {
    client.release();
  }
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

module.exports.cancelOrder = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();

  try {
    const { order_id, reason } = req.body;
    if (!order_id) {
      return next(new AppError("order_id is required", 400));
    }

    await client.query("BEGIN");

    // --------------------------------------------
    // STEP 1: Fetch Order
    // --------------------------------------------
    const { rows: orderRows } = await client.query(
      `SELECT id, user_id, total_amount, payment_status, order_status
       FROM orders
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [order_id]
    );

    if (orderRows.length === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Order not found", 404));
    }

    const order = orderRows[0];

    if (order.order_status === "cancelled") {
      await client.query("ROLLBACK");
      return next(new AppError("Order already cancelled", 400));
    }

    // --------------------------------------------
    // STEP 2: Reverse Stock (Add back stock)
    // --------------------------------------------
    const { rows: items } = await client.query(
      `SELECT id, variant_id, qty
       FROM order_items
       WHERE order_id = $1 AND deleted_at IS NULL`,
      [order_id]
    );

    for (const it of items) {
      if (!it.variant_id) continue;

      const vRes = await client.query(
        `SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE`,
        [it.variant_id]
      );

      if (vRes.rowCount === 0) continue;

      const currentStock = Number(vRes.rows[0].stock || 0);
      const newStock = currentStock + Number(it.qty || 0);

      await client.query(
        `UPDATE product_variants SET stock = $1 WHERE id = $2`,
        [newStock, it.variant_id]
      );

      await client.query(
        `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [
          randomUUID(),
          it.variant_id,
          +Math.abs(it.qty || 0), // POSITIVE since stock is added back
          "order_cancelled",
          order_id,
        ]
      );
    }

    // --------------------------------------------
    // STEP 3: Update Order Status
    // --------------------------------------------
    await client.query(
      `UPDATE orders
       SET order_status = 'cancelled', deleted_at = NULL
       WHERE id = $1`,
      [order_id]
    );

    // --------------------------------------------
    // STEP 4: Fetch customer email to send mail
    // --------------------------------------------
    const { rows: userRows } = await client.query(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [order.user_id]
    );

    const email = userRows[0].email;
    const name = userRows[0].full_name || "Customer";

    // --------------------------------------------
    // STEP 5: Send Cancellation Email
    // --------------------------------------------
    const mailOptions = {
      from: `"${process.env.EMAIL_SENDER_NAME || "Support"}" <${process.env.SMTP_USER
        }>`,
      to: email,
      subject: `Order Cancelled - ${order_id}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fafafa; border-radius: 10px;">
          <h2>Hi ${name},</h2>
          <p>Your order <strong>${order_id}</strong> has been cancelled by our support team.</p>

          ${reason
          ? `<p><strong>Reason:</strong> ${reason}</p>`
          : `<p>The cancellation was processed by our support team.</p>`
        }

          <p>If the payment was already processed, the refund will be initiated to your original mode of payment.</p>

          <p>We apologize for any inconvenience caused.</p>

          <hr/>
          <p style="font-size:12px; color:#777;">© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Order cancelled successfully", {
      order_id,
      restored_stock: items.length,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    console.error("cancelOrder error:", err);
    return next(new AppError(err.message || "Failed to cancel order", 500));
  } finally {
    client.release();
  }
});

module.exports.updatePaymentStatusAfterCancel = catchAsync(
  async (req, res, next) => {
    const client = await dbPool.connect();

    try {
      const { order_id, payment_status } = req.body;

      if (!order_id || !payment_status) {
        return next(
          new AppError("order_id and payment_status are required", 400)
        );
      }

      // Allowed statuses (you can add more later)
      const allowedStatuses = ["refund_initiated", "refund_completed"];

      if (!allowedStatuses.includes(payment_status)) {
        return next(
          new AppError(
            `Invalid payment_status. Allowed values are: ${allowedStatuses.join(
              ", "
            )}`,
            400
          )
        );
      }

      await client.query("BEGIN");

      // -------------------------------------------------------
      // STEP 1: Validate order exists & is cancelled
      // -------------------------------------------------------
      const { rows: orderRows } = await client.query(
        `SELECT id, order_status, payment_status
             FROM orders
             WHERE id = $1 AND deleted_at IS NULL
             FOR UPDATE`,
        [order_id]
      );

      if (orderRows.length === 0) {
        await client.query("ROLLBACK");
        return next(new AppError("Order not found", 404));
      }

      const order = orderRows[0];

      if (order.order_status !== "cancelled") {
        await client.query("ROLLBACK");
        return next(
          new AppError(
            `Order must be cancelled to update payment status. Current status: ${order.order_status}`,
            400
          )
        );
      }

      // -------------------------------------------------------
      // STEP 2: Update payment status
      // -------------------------------------------------------
      await client.query(
        `UPDATE orders
             SET payment_status = $1
             WHERE id = $2`,
        [payment_status, order_id]
      );

      await client.query("COMMIT");

      return sendResponse(
        res,
        200,
        true,
        "Payment status updated successfully",
        {
          order_id,
          payment_status,
        }
      );
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { });
      console.error("updatePaymentStatusAfterCancel error:", err);
      return next(
        new AppError(err.message || "Failed to update payment status", 500)
      );
    } finally {
      client.release();
    }
  }
);
