const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const { UserServices } = require("../../services/userServices");
const { isValidEmail, isValidUUID } = require("../../utils/basicValidation");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");

const generateMagicToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, {
        expiresIn: "15m", // token valid for 15 min
    });
};

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

module.exports.sendAdminMagicLink = catchAsync(async (req, res, next) => {
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

        const { redirectUrl } = req.body;
        const { isValidRedirectUrl } = require("../../utils/basicValidation");

        const token = generateMagicToken(admin.id);

        let baseUrl = process.env.ADMIN_URL;
        if (redirectUrl && isValidRedirectUrl(redirectUrl)) {
            baseUrl = redirectUrl;
        }

        const magicLink = `${baseUrl}/auth?type=magic-login&token=${token}`;

        await client.query(
            `UPDATE admins SET magic_token = $1, magic_token_expires = $2 WHERE id = $3`,
            [token, new Date(Date.now() + 15 * 60 * 1000), admin.id]
        );

        // Send email
        const mailOptions = {
            from: `"${process.env.EMAIL_SENDER_NAME || "Admin Support"}" <no-reply@aayeu.com>`,
            to: email,
            subject: "Your Admin Magic Login Link",
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fafafa; border-radius: 10px;">
          <h2>Hi ${admin.name || "Admin"},</h2>
          <p>Click the button below to securely log in to your admin account:</p>
          <a href="${magicLink}" 
            style="display:inline-block; padding:10px 20px; background-color:#007bff; color:#fff; text-decoration:none; border-radius:5px;">
            Login Now
          </a>
          <p style="margin-top:15px;">This link will expire in 15 minutes.</p>
          <p>If you didn't request this, you can ignore this email.</p>
        </div>
      `,
        };

        await transporter.sendMail(mailOptions);

        await client.query("COMMIT");

        return sendResponse(res, 200, true, "Magic link sent to your email", { magicLink });
    } catch (err) {
        await client.query("ROLLBACK");
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.adminLoginWithMagicLink = catchAsync(async (req, res, next) => {
    const { token } = req.body;
    if (!token) return next(new AppError("Token is required", 400));

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        console.log(err);
        return next(new AppError(err.message, 400));
    }

    const { userId } = decoded;
    const client = await dbPool.connect();

    try {
        await client.query("BEGIN");

        const { rows } = await client.query(
            `SELECT * FROM admins WHERE id = $1 AND deleted_at IS NULL`,
            [userId]
        );

        const admin = rows[0];
        if (!admin) throw new AppError("Admin not found", 404);

        // Check token validity
        if (!admin.magic_token || admin.magic_token !== token || !admin.magic_token_expires || new Date(admin.magic_token_expires) < new Date()) {
            throw new AppError("Magic link expired or invalid", 400);
        }

        // Clear magic token
        await client.query(
            `UPDATE admins SET magic_token = NULL, magic_token_expires = NULL WHERE id = $1`,
            [admin.id]
        );

        // Generate access token
        const accessToken = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET, {
            expiresIn: "1d",
        });

        await client.query("COMMIT");

        return sendResponse(res, 200, true, "Admin login successful", { ...admin, accessToken });
    } catch (err) {
        await client.query("ROLLBACK");
        return next(err);
    } finally {
        client.release();
    }
});