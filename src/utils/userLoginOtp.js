const crypto = require("crypto");

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function hashUserLoginOtp(userId, otp) {
  const normalized = String(otp).replace(/\s/g, "");
  return crypto
    .createHmac("sha256", `${process.env.JWT_SECRET}:user_login_otp`)
    .update(`${userId}:${normalized}`)
    .digest("hex");
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function buildUserLoginOtpEmailHtml({
  otp,
  greetingName,
  headline,
  extraParagraph = "",
}) {
  return `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fafafa; border-radius: 10px;">
          <h2>Hi ${greetingName},</h2>
          <p>${headline}</p>
          <p style="font-size: 28px; letter-spacing: 0.25em; font-weight: bold; margin: 24px 0;">${otp}</p>
          <p style="color:#666;">This code expires in 10 minutes.</p>
          ${extraParagraph}
          <p style="margin-top:16px;">If you didn't request this, you can ignore this email.</p>
          <hr style="margin-top:20px; border:none; border-top:1px solid #eee;"/>
          <p style="font-size:12px; color:#777;">© ${new Date().getFullYear()} AAYEU.</p>
        </div>
      `;
}

module.exports = {
  OTP_EXPIRY_MS,
  hashUserLoginOtp,
  generateSixDigitOtp,
  buildUserLoginOtpEmailHtml,
};
