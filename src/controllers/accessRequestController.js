const AppError = require("../errorHandling/AppError");
const catchAsync = require("../errorHandling/catchAsync");
const sendResponse = require("../utils/sendResponse");
const { randomUUID } = require("crypto");
const dbPool = require("../db/dbConnection");
const nodemailer = require("nodemailer");
const { UserServices } = require("../services/userServices");
const { isValidEmail } = require("../utils/basicValidation");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Public: latest access-request state for an email (for storefront dialogs).
 * accessStatus: none | pending | approved
 */
module.exports.getAccessRequestStatus = catchAsync(async (req, res, next) => {
  let { email } = req.body;
  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  email = email.toLowerCase().trim();

  const { rows } = await dbPool.query(
    `SELECT status FROM access_requests
     WHERE LOWER(TRIM(email)) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );
  const row = rows[0];
  let accessStatus = "none";
  if (row) {
    const st = String(row.status || "");
    if (st === "approved" || st === "link_sent") accessStatus = "approved";
    else if (st === "pending") accessStatus = "pending";
  }

  return sendResponse(res, 200, true, "OK", { accessStatus });
});

/** Public: submit access request (non-allowed domain users) */
module.exports.createAccessRequest = catchAsync(async (req, res, next) => {
  const { full_name, email } = req.body;

  if (!full_name || !email) {
    return next(new AppError("Full name and email are required", 400));
  }
  if (!isValidEmail(email)) {
    return next(new AppError("Invalid email", 400));
  }

  const normalizedEmail = email.toLowerCase().trim();

  const { rows: existingRows } = await dbPool.query(
    `SELECT id, status FROM access_requests
     WHERE LOWER(TRIM(email)) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );
  const latest = existingRows[0];
  if (latest) {
    const st = String(latest.status || "");
    if (st === "approved" || st === "link_sent") {
      return sendResponse(
        res,
        200,
        true,
        "You are already approved. Open Sign in, enter this email, and we will email you a one-time code to complete login.",
        { alreadyApproved: true, email: normalizedEmail }
      );
    }
    if (st === "pending") {
      return sendResponse(
        res,
        200,
        true,
        "We already have an access request for this email. Please wait — we will email you as soon as it is reviewed.",
        { alreadyPending: true, email: normalizedEmail }
      );
    }
  }

  const id = randomUUID();

  await dbPool.query(
    `INSERT INTO access_requests (id, full_name, email, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
    [id, full_name.trim(), normalizedEmail]
  );

  return sendResponse(
    res,
    201,
    true,
    `Thanks, ${full_name.trim().split(/\s+/)[0] || "there"}. We received your request and will email you at ${normalizedEmail} when your access is approved.`,
    {
      id,
      full_name: full_name.trim(),
      email: normalizedEmail,
      submitted: true,
    }
  );
});

/** Admin: list all access requests */
module.exports.getAllAccessRequests = catchAsync(async (req, res, next) => {
  const result = await dbPool.query(
    `SELECT id, full_name, email, status, magic_link_sent_at, created_at, updated_at
     FROM access_requests
     ORDER BY created_at DESC`
  );
  return sendResponse(res, 200, true, "Access requests fetched", result.rows);
});

/**
 * Admin: approve access request — create user if needed, mark approved,
 * email the requester that they can sign in (they use normal email + OTP on the site).
 */
module.exports.approveAccessRequest = catchAsync(async (req, res, next) => {
  const { id } = req.body;
  if (!id) return next(new AppError("Request id is required", 400));

  const client = await dbPool.connect();
  try {
    const reqResult = await client.query(
      `SELECT id, full_name, email, status FROM access_requests WHERE id = $1`,
      [id]
    );
    if (reqResult.rowCount === 0) {
      return next(new AppError("Access request not found", 404));
    }
    const accessRequest = reqResult.rows[0];
    const { full_name, email } = accessRequest;

    await client.query("BEGIN");

    let user = await UserServices.findUserByEmail(email, client);
    if (!user) {
      user = await UserServices.createUser(
        {
          full_name,
          email,
          phone: null,
          provider: "local",
          google_sub: null,
          apple_sub: null,
        },
        client
      );
    }

    const siteUrl =
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      "https://aayeu.com";

    const mailOptions = {
      from: `"${process.env.EMAIL_SENDER_NAME || "AAYEU Support"}" <no-reply@aayeu.com>`,
      to: email,
      subject: "Your AAYEU access has been approved",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; background: #fafafa; border-radius: 10px; max-width: 560px;">
          <h2 style="color: #333;">Hi ${full_name || "there"},</h2>
          <p style="color: #555; line-height: 1.5;">Great news — your access request for <b>AAYEU</b> has been <b>approved</b>.</p>
          <p style="color: #555; line-height: 1.5;">You can sign in now using your email address. We’ll send you a short verification code when you choose to log in.</p>
          <p style="margin: 24px 0;">
            <a href="${siteUrl}/auth?type=signin"
               style="display:inline-block; padding: 12px 22px; background-color: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Go to sign in
            </a>
          </p>
          <p style="color: #888; font-size: 13px;">If you didn’t request access, you can ignore this email.</p>
          <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #aaa;">© ${new Date().getFullYear()} AAYEU</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    await client.query(
      `UPDATE access_requests SET status = 'approved', magic_link_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Request approved and notification sent to " + email, {
      email,
      approved: true,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

/** @deprecated Use approveAccessRequest — kept for older admin clients. */
module.exports.sendMagicLinkToRequest = module.exports.approveAccessRequest;
