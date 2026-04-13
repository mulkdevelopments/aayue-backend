// controllers/newsletterController.js
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const db = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendNewsletterWelcomeEmail(toEmail) {
  const siteName = process.env.EMAIL_SENDER_NAME || "AAYEU";
  const mailOptions = {
    from: `"${siteName}" <no-reply@aayeu.com>`,
    to: toEmail,
    subject: `You're subscribed — ${siteName} updates`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 24px; background: #fafafa; border-radius: 10px; max-width: 560px;">
        <h2 style="color: #111;">Thanks for subscribing</h2>
        <p style="color: #444; line-height: 1.6;">You're on the list for promotions, new arrivals, and stock updates from <b>${siteName}</b>.</p>
        <p style="color: #666; font-size: 14px;">You can unsubscribe anytime using the link in any marketing email we send.</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #aaa;">© ${new Date().getFullYear()} ${siteName}</p>
      </div>
    `,
  };
  await transporter.sendMail(mailOptions);
}

/**
 * PUBLIC: Subscribe to newsletter
 * POST .../subscribe-newsletter
 * body: { email }
 */
module.exports.subscribeNewsletter = catchAsync(async (req, res, next) => {
  const { email } = req.body || {};

  if (!email) {
    return next(new AppError("Email is required", 400));
  }

  const emailTrimmed = String(email).trim().toLowerCase();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailTrimmed)) {
    return next(new AppError("Invalid email format", 400));
  }

  const { rows: existingRows } = await db.query(
    `SELECT id, email, is_active FROM newsletter_subscribers WHERE email = $1`,
    [emailTrimmed]
  );
  const existing = existingRows[0];

  if (existing && existing.is_active === true) {
    return sendResponse(
      res,
      200,
      true,
      "You're already subscribed with this email.",
      { alreadySubscribed: true, email: emailTrimmed }
    );
  }

  if (existing) {
    const { rows } = await db.query(
      `UPDATE newsletter_subscribers
       SET is_active = true, updated_at = NOW()
       WHERE email = $1
       RETURNING id, email, is_active, created_at, updated_at`,
      [emailTrimmed]
    );
    try {
      await sendNewsletterWelcomeEmail(emailTrimmed);
    } catch (err) {
      console.error("Newsletter welcome email failed:", err);
    }
    return sendResponse(
      res,
      200,
      true,
      "Welcome back — you're subscribed again. We've sent a confirmation to your inbox.",
      { subscriber: rows[0], resubscribed: true }
    );
  }

  const id = randomUUID();
  const { rows } = await db.query(
    `INSERT INTO newsletter_subscribers (
      id, email, is_active, created_at, updated_at
    )
    VALUES ($1, $2, true, NOW(), NOW())
    RETURNING id, email, is_active, created_at, updated_at`,
    [id, emailTrimmed]
  );

  try {
    await sendNewsletterWelcomeEmail(emailTrimmed);
  } catch (err) {
    console.error("Newsletter welcome email failed:", err);
  }

  return sendResponse(
    res,
    201,
    true,
    "Thanks for subscribing — we've sent a confirmation email to your inbox.",
    { subscriber: rows[0] }
  );
});

/**
 * PUBLIC: Unsubscribe from newsletter
 */
module.exports.unsubscribeNewsletter = catchAsync(async (req, res, next) => {
  const { email } = req.body || {};

  if (!email) {
    return next(new AppError("Email is required", 400));
  }

  const emailTrimmed = String(email).trim().toLowerCase();

  const result = await db.query(
    `UPDATE newsletter_subscribers
     SET is_active = false,
         updated_at = NOW()
     WHERE email = $1
     RETURNING id, email, is_active, created_at, updated_at`,
    [emailTrimmed]
  );

  if (result.rowCount === 0) {
    return sendResponse(res, 200, true, "You are not subscribed or already unsubscribed", null);
  }

  return sendResponse(res, 200, true, "Unsubscribed from newsletter successfully", {
    subscriber: result.rows[0],
  });
});

/** ADMIN */
module.exports.getAllNewsletterSubscribers = catchAsync(async (req, res, next) => {
  const result = await db.query(
    `SELECT id, email, is_active, created_at, updated_at
     FROM newsletter_subscribers
     ORDER BY created_at DESC`
  );

  return sendResponse(res, 200, true, "Newsletter subscribers fetched", result.rows);
});

module.exports.deleteNewsletterSubscriber = catchAsync(async (req, res, next) => {
  const id = req.query.id;
  if (!id) {
    return next(new AppError("Subscriber ID is required", 400));
  }

  const result = await db.query(`DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING id`, [id]);

  if (result.rowCount === 0) {
    return next(new AppError("Subscriber not found", 404));
  }

  return sendResponse(res, 200, true, "Subscriber deleted");
});
