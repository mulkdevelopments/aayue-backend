// controllers/userController/orderController.js
const catchAsync = require("../../errorHandling/catchAsync");
const dbPool = require("../../db/dbConnection");
const OrderService = require("../../services/orderService");
const { fetchCarrierTimeline } = require("../../services/carrierTracking17Service");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");

const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function orderContainsTrackingNumber(order, number) {
  const n = String(number || "").trim();
  if (!n) return false;
  for (const it of order.items || []) {
    let tc = it.tracking_codes;
    if (typeof tc === "string") {
      try {
        tc = JSON.parse(tc);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(tc)) continue;
    for (const t of tc) {
      const code = t?.trackingCode ?? t?.code ?? t?.number;
      if (code != null && String(code).trim() === n) return true;
    }
  }
  return false;
}

module.exports.getUserPaidOrders = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "20", 10))
    );
    const offset = (page - 1) * limit;

    // optional filters (order_status query maps to payment_status filter in service)
    const { from_date, to_date, order_status } = req.query;
    // Default: paid + returned/refunded (refund_completed, etc.). Use order_status=paid for paid only; order_status=all for any payment_status.
    const statusFilter = order_status || "paid_or_refunded";

    const { total, orders } = await OrderService.getUserPaidOrders(
      {
        user_id,
        page,
        limit,
        offset,
        status: statusFilter,
        from_date: from_date || null,
        to_date: to_date || null,
      },
      client
    );

    const total_pages = Math.max(1, Math.ceil(total / limit));

    return sendResponse(res, 200, true, "Orders fetched", {
      total,
      page,
      limit,
      total_pages,
      orders,
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.getUserOrderById = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const id = req.query.orderId;
    if (!id) return next(new AppError("Order id required", 400));

    const order = await OrderService.getUserOrderById(
      { user_id, order_id: id },
      client
    );
    if (!order) return next(new AppError("Order not found", 404));

    return sendResponse(res, 200, true, "Order fetched", order);
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.downloadInvoiceHtml = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const user_id = req.user?.id;
    if (!user_id) return next(new AppError("Unauthorized", 401));

    const orderId = req.query.orderId;
    if (!orderId) return next(new AppError("Order ID required", 400));

    let pdfPath = await OrderService.getOrGenerateInvoice(
      { user_id, order_id: orderId },
      client,
      res
    );

    const fileName = `invoice_${orderId}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.download(pdfPath, fileName, (err) => {
      if (err) {
        return next(new AppError("Error downloading the invoice", 500));
      }
    });
  } catch (err) {
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * Customer cancels a processing, paid order: Stripe full refund + restore stock + cancel order.
 * If DB fails after refund, retry completes cancellation (refund already exists on the PaymentIntent).
 */
module.exports.cancelOrderByCustomer = catchAsync(async (req, res, next) => {
  const user_id = req.user?.id;
  if (!user_id) return next(new AppError("Unauthorized", 401));

  const order_id = req.body?.order_id || req.body?.orderId;
  if (!order_id) return next(new AppError("order_id is required", 400));

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const { rows: orderRows } = await client.query(
      `SELECT id, user_id, payment_status, order_status, order_no
       FROM orders
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [order_id, user_id]
    );

    if (orderRows.length === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Order not found", 404));
    }

    const order = orderRows[0];

    if (String(order.order_status || "").toLowerCase() === "cancelled") {
      await client.query("ROLLBACK");
      return next(new AppError("Order is already cancelled", 400));
    }

    if (String(order.order_status || "").toLowerCase() !== "processing") {
      await client.query("ROLLBACK");
      return next(
        new AppError(
          "You can only cancel orders that are still processing. Contact support for other cases.",
          400
        )
      );
    }

    if (String(order.payment_status || "").toLowerCase() !== "paid") {
      await client.query("ROLLBACK");
      return next(
        new AppError(
          "Only paid orders can be cancelled this way. Please contact support.",
          400
        )
      );
    }

    const { rows: vendorPaidRows } = await client.query(
      `SELECT 1 FROM order_items
       WHERE order_id = $1 AND deleted_at IS NULL AND vendor_paid_at IS NOT NULL
       LIMIT 1`,
      [order_id]
    );
    if (vendorPaidRows.length > 0) {
      await client.query("ROLLBACK");
      return next(
        new AppError(
          "This order can no longer be cancelled because payment has already been sent to a supplier. Please contact support.",
          400
        )
      );
    }

    const { rows: payRows } = await client.query(
      `SELECT stripe_payment_intent_id FROM payments WHERE order_id = $1 LIMIT 1`,
      [order_id]
    );
    const stripePi = payRows[0]?.stripe_payment_intent_id;
    if (!stripePi) {
      await client.query("ROLLBACK");
      return next(
        new AppError(
          "We could not find your card payment for this order. Please contact support for a refund.",
          400
        )
      );
    }

    let refund;
    try {
      const pi = await stripe.paymentIntents.retrieve(stripePi);
      const received =
        typeof pi.amount_received === "number"
          ? pi.amount_received
          : pi.amount || 0;

      const existing = await stripe.refunds.list({
        payment_intent: stripePi,
        limit: 30,
      });
      const succeededCents = existing.data
        .filter((r) => r.status === "succeeded")
        .reduce((sum, r) => sum + (r.amount || 0), 0);
      const pending = existing.data.filter(
        (r) =>
          r.status === "pending" || r.status === "requires_action"
      );

      if (succeededCents >= received && received > 0) {
        refund = existing.data.find((r) => r.status === "succeeded") || {
          id: "already_refunded",
        };
      } else if (pending.length > 0) {
        refund = pending[0];
      } else if (succeededCents > 0 && succeededCents < received) {
        await client.query("ROLLBACK");
        return next(
          new AppError(
            "This order has a partial refund. Please contact support to cancel.",
            400
          )
        );
      } else {
        refund = await stripe.refunds.create(
          {
            payment_intent: stripePi,
            reason: "requested_by_customer",
          },
          { idempotencyKey: `customer_cancel_${order_id}` }
        );
      }
    } catch (stripeErr) {
      await client.query("ROLLBACK");
      console.error("cancelOrderByCustomer Stripe error:", stripeErr);
      return next(
        new AppError(
          stripeErr.message ||
            "Refund could not be processed. Please try again or contact support.",
          502
        )
      );
    }

    const { rows: items } = await client.query(
      `SELECT id, variant_id, qty FROM order_items WHERE order_id = $1 AND deleted_at IS NULL`,
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
          +Math.abs(it.qty || 0),
          "order_cancelled_customer",
          order_id,
        ]
      );
    }

    await client.query(
      `UPDATE orders
       SET order_status = 'cancelled', payment_status = 'refund_completed', deleted_at = NULL
       WHERE id = $1`,
      [order_id]
    );

    await client.query(`UPDATE payments SET status = 'refunded' WHERE order_id = $1`, [
      order_id,
    ]);

    const { rows: userRows } = await client.query(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [user_id]
    );
    const email = userRows[0]?.email;
    const name = userRows[0]?.full_name || "Customer";
    const orderDisplay =
      order.order_no && String(order.order_no).trim()
        ? String(order.order_no).trim()
        : order_id;

    await client.query("COMMIT");

    if (email) {
      try {
        await mailTransporter.sendMail({
          from: `"${process.env.EMAIL_SENDER_NAME || "Support"}" <${
            process.env.EMAIL_FROM || process.env.SMTP_USER
          }>`,
          to: email,
          subject: `Order cancelled & refund — ${orderDisplay}`,
          html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fafafa; border-radius: 10px;">
          <h2>Hi ${name},</h2>
          <p>You cancelled order <strong>#${orderDisplay}</strong>.</p>
          <p>Your payment has been refunded to your original payment method. It may take a few business days to appear.</p>
          <p>Thank you for shopping with us.</p>
        </div>`,
        });
      } catch (e) {
        console.warn("cancelOrderByCustomer email:", e.message);
      }
    }

    return sendResponse(res, 200, true, "Order cancelled and refund processed", {
      order_id,
      refund_id: refund?.id || null,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("cancelOrderByCustomer:", err);
    return next(new AppError(err.message || "Failed to cancel order", 500));
  } finally {
    client.release();
  }
});

module.exports.getShipmentTrackingTimeline = catchAsync(async (req, res, next) => {
  const user_id = req.user?.id;
  if (!user_id) return next(new AppError("Unauthorized", 401));
  const orderId = req.query.orderId;
  const number = req.query.number;
  const carrier = req.query.carrier || "";
  if (!orderId || !number) {
    return next(new AppError("orderId and number are required", 400));
  }

  const client = await dbPool.connect();
  try {
    const order = await OrderService.getUserOrderById(
      { user_id, order_id: orderId },
      client
    );
    if (!order) return next(new AppError("Order not found", 404));
    if (!orderContainsTrackingNumber(order, number)) {
      return next(new AppError("Tracking not found for this order", 403));
    }
    const result = await fetchCarrierTimeline(String(number).trim(), carrier);
    return sendResponse(res, 200, true, "Shipment tracking", result);
  } finally {
    client.release();
  }
});
