// mail/invoiceMailer.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");



/* ---------- Transporter singleton ---------- */
let transporterInstance = null;
function getTransporter() {
  if (transporterInstance) return transporterInstance;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP configuration missing. Set SMTP_HOST, SMTP_USER and SMTP_PASS in env."
    );
  }

  transporterInstance = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: { user, pass },
    // Optional: you can add pool: true for high throughput
  });

  return transporterInstance;
}

