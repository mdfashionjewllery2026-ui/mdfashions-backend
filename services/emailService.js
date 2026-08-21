const nodemailer = require('nodemailer');
const { generatePasswordResetEmail } = require('./email/passwordResetTemplate');

/**
 * MD Fashions Centralized Email Delivery Service
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.MAIL_HOST || process.env.SMTP_HOST;
    const port = Number(process.env.MAIL_PORT || process.env.SMTP_PORT || 465);
    const user = process.env.MAIL_USER || process.env.SMTP_USER;
    const pass = process.env.MAIL_PASSWORD || process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
    const secure = process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : (port === 465);

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });
      console.log(`✅ [EmailService] Initialized SMTP transporter for ${user} via ${host}:${port}`);
    } else {
      console.warn('⚠️ [EmailService] SMTP credentials not configured in environment. Outgoing emails will be logged.');
    }
  }

  /**
   * Send Password Reset Email with MD Fashions Branding
   */
  async sendPasswordResetMail({ to, resetLink }) {
    const fromEmail = process.env.MAIL_FROM_EMAIL || 'noreply@mdfashions.in';
    const fromName = process.env.MAIL_FROM_NAME || 'MD Fashions';
    const formattedFrom = `"${fromName}" <${fromEmail}>`;

    const { html, text, subject } = generatePasswordResetEmail({ resetLink, recipientEmail: to });

    const mailOptions = {
      from: formattedFrom,
      to,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
        'List-Unsubscribe': '<mailto:support@mdfashions.in>'
      }
    };

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`✅ [EmailService] Password reset email delivered to ${to} (messageId: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
      } catch (err) {
        console.error(`❌ [EmailService] SMTP Delivery Error for ${to}:`, err.message);
        throw err;
      }
    } else {
      console.log(`📨 [EmailService - DEV MODE] Email simulation for ${to}:`);
      console.log(`   From: ${formattedFrom}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Reset Link: ${resetLink}`);
      return { success: true, mode: 'dev-logged' };
    }
  }
}

module.exports = new EmailService();
