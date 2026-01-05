const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const {
  generateOrderConfirmationEmail,
} = require("../template/orderPlaceTemplate");
const { generateOrderStatusEmail } = require("../template/oderStatusTemplate");
const {
  generateAdminNewOrderEmail,
} = require("../template/newOrderRecieveTemplate");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOrderConfirmation = async (to, orderData) => {
  const { customerName, orderId, items, payment_id } = orderData;

  const html = generateOrderConfirmationEmail({
    customerName,
    orderId,
    items,
  });

  const mailOptions = {
    from: `"${process.env.EMAIL_SENDER_NAME || 'Aayeu'}" <${process.env.EMAIL_FROM || 'no-reply@aayeu.com'}>`,
    to,
    subject: `Order Confirmation - #${orderId}`,
    html,
  };

  await transporter.sendMail(mailOptions);
  console.log(`Email sent to ${to} for Order #${orderId}`);
};

/* ---------- Utility: sleep for backoff ---------- */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Main function ---------- */
async function sendInvoiceAttachmentEmail({
  to,
  customerName = "",
  pdfFullPath,
  subject = null,
  textBody = null,
  htmlBody = null,
  maxRetries = 3,
  from = process.env.EMAIL_FROM || process.env.SMTP_USER,
}) {
  if (!to) throw new Error("Recipient email (to) is required.");
  if (!pdfFullPath) throw new Error("pdfFullPath is required.");

  // Normalize and ensure absolute path
  const fullPath = path.isAbsolute(pdfFullPath)
    ? pdfFullPath
    : path.join(process.cwd(), pdfFullPath);

  // Check file exists and is readable
  try {
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) throw new Error("Provided invoice path is not a file.");
  } catch (err) {
    const msg = `Invoice PDF not found at path: ${fullPath} — ${err.message}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Default subject / bodies if not supplied
  const invoiceFileName = path.basename(fullPath);
  const company = process.env.COMPANY_NAME || "AAYEU";
  const finalSubject =
    subject || `Your Invoice from ${company} — ${invoiceFileName}`;

  const finalText =
    textBody ||
    `Hello ${customerName || ""},

Thank you for shopping with ${company}.

Please find your invoice attached: ${invoiceFileName}

If you have any questions, simply reply to this email.

Best regards,
${company} Support Team`;

  const finalHtml =
    htmlBody ||
    `<p>Hello <strong>${customerName || ""}</strong>,</p>
<p>Thank you for shopping with <strong>${company}</strong>.</p>
<p>Please find your invoice attached: <strong>${invoiceFileName}</strong></p>
<br/>
<p>Best regards,<br/>${company} Support Team</p>`;

  // Attach file as stream/buffer
  const attachment = {
    filename: invoiceFileName,
    path: fullPath,
    contentType: "application/pdf",
  };

  // Attempt sending with retries
  let attempt = 0;
  let lastError = null;
  while (attempt < maxRetries) {
    try {
      attempt += 1;
      const info = await transporter.sendMail({
        from,
        to,
        subject: finalSubject,
        text: finalText,
        html: finalHtml,
        attachments: [attachment],
      });

      console.info(
        `[invoiceMailer] Email sent to ${to} (attempt ${attempt}) messageId=${info?.messageId}`
      );
      return { ok: true, info };
    } catch (err) {
      lastError = err;
      console.warn(
        `[invoiceMailer] Failed to send invoice email to ${to} (attempt ${attempt}):`,
        err && err.message ? err.message : err
      );

      // exponential backoff: 500ms * 2^(attempt-1)
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }

  // If we reach here, all retries failed
  console.error(
    `[invoiceMailer] All ${maxRetries} attempts failed for ${to}. Last error:`,
    lastError && lastError.message ? lastError.message : lastError
  );

  // Throw to allow the caller to decide (or you can return a failure object instead)
  throw new Error(
    `Failed to send invoice email after ${maxRetries} attempts: ${lastError?.message}`
  );
}

const sendOrderStatusEmail = async (to, orderData) => {
  let { customerName, orderId, items, status } = orderData;

  const html = generateOrderStatusEmail({
    customerName,
    orderId,
    items,
    status,
  });
  const mailOptions = {
    from: `"${process.env.EMAIL_SENDER_NAME || 'Aayeu'}" <${process.env.EMAIL_FROM || 'no-reply@aayeu.com'}>`,
    to,
    subject: `Order Status Update - #${orderId}`,
    html,
  };

  await transporter.sendMail(mailOptions);
  console.log(`Email sent to ${to} for Order #${orderId}`);
};

const sendNewOrderNotificationEmail = async (toList, orderData) => {
  const {
    customerName,
    orderId,
    items,
    total,
    currency = "EUR",
    currencySymbol = "€",
    customerEmail,
    customerPhone,
  } = orderData;

  const html = generateAdminNewOrderEmail({
    customerName,
    customerEmail,
    customerPhone,
    orderId,
    items,
    total,
    currency: currencySymbol || currency,
  });

  const mailOptions = {
    from: `"${process.env.EMAIL_SENDER_NAME || 'Aayeu'}" <${process.env.EMAIL_FROM || 'no-reply@aayeu.com'}>`,
    to: Array.isArray(toList) ? toList.join(",") : toList, // Convert to CSV
    subject: `🛍️ New Order Received - #${orderId}`,
    html,
  };
  await transporter.sendMail(mailOptions);
  return true;
};

module.exports = {
  sendInvoiceAttachmentEmail,
  sendOrderConfirmation,
  sendOrderStatusEmail,
  sendNewOrderNotificationEmail,
};
