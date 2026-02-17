const AppError = require("../errorHandling/AppError");
const catchAsync = require("../errorHandling/catchAsync");
const sendResponse = require("../utils/sendResponse");
const { randomUUID } = require("crypto");
const dbPool = require("../db/dbConnection");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { UserServices } = require("../services/userServices");
const { isValidEmail } = require("../utils/basicValidation");

const generateMagicToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "15m" });
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
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
  const id = randomUUID();

  await dbPool.query(
    `INSERT INTO access_requests (id, full_name, email, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
    [id, full_name.trim(), normalizedEmail]
  );

  return sendResponse(res, 201, true, "Access request submitted. We'll be in touch.", {
    id,
    full_name: full_name.trim(),
    email: normalizedEmail,
  });
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

/** Admin: send magic link to a requested user (create user if not exists, then send link) */
module.exports.sendMagicLinkToRequest = catchAsync(async (req, res, next) => {
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

    const token = generateMagicToken(user.id);
    const baseUrl = process.env.CLIENT_URL || "https://aayeu.com";
    const magicLink = `${baseUrl}/auth?type=magic-login&token=${token}`;

    await UserServices.updateUserMagicToken(
      {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
      client
    );

    const mailOptions = {
      from: `"${process.env.EMAIL_SENDER_NAME || "AAYEU Support"}" <no-reply@aayeu.com>`,
      to: email,
      subject: "Your AAYEU Access — Magic Login Link",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 25px; background-color: #f9f9f9; border-radius: 10px;">
          <h2 style="color: #333;">Hi ${full_name || "there"} 👋</h2>
          <p style="color: #555;">Your access request to <b>AAYEU</b> has been approved.</p>
          <p>Click the button below to log in:</p>
          <a href="${magicLink}" 
            style="display:inline-block; padding:12px 20px; background-color:#007bff; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold;">
            Login Now
          </a>
          <p style="margin-top:20px; color:#777;">This link expires in <b>15 minutes</b>.</p>
          <hr style="margin-top:25px; border:none; border-top:1px solid #eee;"/>
          <p style="font-size:12px; color:#aaa;">© ${new Date().getFullYear()} AAYEU.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    await client.query(
      `UPDATE access_requests SET status = 'link_sent', magic_link_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Magic link sent to " + email, {
      email,
      magicLinkSent: true,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});
