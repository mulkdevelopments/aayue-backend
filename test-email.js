// Test email configuration
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('========================================');
console.log('📧 Testing Email Configuration');
console.log('========================================');

console.log('\n📋 SMTP Configuration:');
console.log('  Host:', process.env.SMTP_HOST);
console.log('  Port:', process.env.SMTP_PORT);
console.log('  User:', process.env.SMTP_USER);
console.log('  From:', process.env.EMAIL_FROM);
console.log('  Secure:', process.env.SMTP_SECURE);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'email-smtp.eu-north-1.amazonaws.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Test connection
console.log('\n🔌 Testing SMTP connection...');
transporter.verify()
  .then(() => {
    console.log('✅ SMTP connection successful!');

    // Send test email
    console.log('\n📤 Sending test email...');

    const mailOptions = {
      from: `"${process.env.EMAIL_SENDER_NAME || 'Aayeu'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Send to yourself for testing
      subject: 'Test Email from Aayeu Backend',
      html: `
        <h1>Email Configuration Test</h1>
        <p>This is a test email from your Aayeu backend server.</p>
        <p>If you received this, your email configuration is working correctly!</p>
        <hr>
        <p><small>Sent at: ${new Date().toISOString()}</small></p>
      `,
    };

    return transporter.sendMail(mailOptions);
  })
  .then((info) => {
    console.log('✅ Test email sent successfully!');
    console.log('   Message ID:', info.messageId);
    console.log('   Response:', info.response);
    console.log('\n========================================');
    console.log('✅ Email configuration is working!');
    console.log('========================================');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Email test failed:');
    console.error('   Error:', error.message);
    console.error('\n📝 Troubleshooting:');
    console.error('   1. Check your SMTP credentials in .env file');
    console.error('   2. Verify AWS SES credentials are correct');
    console.error('   3. Ensure your email is verified in AWS SES');
    console.error('   4. Check if port 587 is not blocked');
    console.log('\n========================================');
    process.exit(1);
  });
