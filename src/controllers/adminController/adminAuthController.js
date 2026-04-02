const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const { isValidEmail } = require("../../utils/basicValidation");
const nodemailer = require("nodemailer");

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function hashAdminOtp(adminId, otp) {
  const normalized = String(otp).replace(/\s/g, "");
  return crypto
    .createHmac("sha256", `${process.env.JWT_SECRET}:admin_login_otp`)
    .update(`${adminId}:${normalized}`)
    .digest("hex");
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/** Send email OTP for admin login (stores HMAC in magic_token / magic_token_expires). */
module.exports.sendAdminLoginOtp = catchAsync(async (req, res, next) => {
  let email = req.body?.email;
  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  email = email.toLowerCase();

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM admins WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    const admin = rows[0];
    if (!admin) throw new AppError("Admin not found", 404);

    const otp = generateSixDigitOtp();
    const otpHash = hashAdminOtp(admin.id, otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await client.query(
      `UPDATE admins SET magic_token = $1, magic_token_expires = $2, updated_at = NOW() WHERE id = $3`,
      [otpHash, expiresAt, admin.id]
    );

    const mailOptions = {
      from: `"${process.env.EMAIL_SENDER_NAME || "Admin Support"}" <no-reply@aayeu.com>`,
      to: email,
      subject: "Your admin login code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fafafa; border-radius: 10px;">
          <h2>Hi ${admin.name || "Admin"},</h2>
          <p>Use this code to sign in to the admin dashboard:</p>
          <p style="font-size: 28px; letter-spacing: 0.25em; font-weight: bold; margin: 24px 0;">${otp}</p>
          <p style="color:#666;">This code expires in 10 minutes.</p>
          <p style="margin-top:16px;">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "We sent a login code to your email", null);
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

/** Verify OTP and return admin JWT (clears magic_token). */
module.exports.adminVerifyLoginOtp = catchAsync(async (req, res, next) => {
  let email = req.body?.email;
  const normalizedOtp = String(req.body?.otp ?? "").replace(/\s/g, "");
  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return next(new AppError("Enter the 6-digit code from your email", 400));
  }
  email = email.toLowerCase();

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM admins WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    const admin = rows[0];
    if (!admin) throw new AppError("Admin not found", 404);

    if (
      !admin.magic_token ||
      !admin.magic_token_expires ||
      new Date(admin.magic_token_expires) < new Date()
    ) {
      throw new AppError("Code expired or invalid. Request a new code.", 400);
    }

    const submittedHash = hashAdminOtp(admin.id, normalizedOtp);
    const storedBuf = Buffer.from(admin.magic_token, "utf8");
    const submittedBuf = Buffer.from(submittedHash, "utf8");
    if (
      storedBuf.length !== submittedBuf.length ||
      !crypto.timingSafeEqual(storedBuf, submittedBuf)
    ) {
      throw new AppError("Invalid code", 400);
    }

    await client.query(
      `UPDATE admins SET magic_token = NULL, magic_token_expires = NULL, updated_at = NOW() WHERE id = $1`,
      [admin.id]
    );

    const accessToken = jwt.sign(
      { userId: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Admin login successful", { ...admin, accessToken });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});
