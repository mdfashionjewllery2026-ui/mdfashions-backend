const https = require('https');
const nodemailer = require('nodemailer');
const { generatePasswordResetEmail } = require('./email/passwordResetTemplate');

/**
 * MD Fashions Centralized Email Delivery Service (Resend API + SMTP)
 */
class EmailService {
  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY || (process.env.SMTP_PASS && process.env.SMTP_PASS.startsWith('re_') ? process.env.SMTP_PASS : null);
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    if (this.resendApiKey) {
      console.log('✅ [EmailService] Initialized Resend HTTP Email API for Inbox Delivery');
      return;
    }

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
      console.warn('⚠️ [EmailService] Email credentials not configured in environment. Outgoing emails will be logged.');
    }
  }

  /**
   * Send via Resend REST API
   */
  async sendWithResend({ from, to, subject, html, text }) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text
      });

      const req = https.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, messageId: parsed.id });
            } else {
              reject(new Error(parsed.message || `Resend error: HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Resend response: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(data);
      req.end();
    });
  }

  /**
   * Send Password Reset Email with MD Fashions Branding
   */
  async sendPasswordResetMail({ to, resetLink }) {
    const fromEmail = process.env.MAIL_FROM_EMAIL || 'onboarding@resend.dev';
    const fromName = process.env.MAIL_FROM_NAME || 'MD Fashions';
    const formattedFrom = `"${fromName}" <${fromEmail}>`;

    const { html, text, subject } = generatePasswordResetEmail({ resetLink, recipientEmail: to });

    if (this.resendApiKey) {
      try {
        const info = await this.sendWithResend({
          from: formattedFrom,
          to,
          subject,
          html,
          text
        });
        console.log(`✅ [EmailService - Resend API] Password reset email delivered to ${to} (id: ${info.messageId})`);
        return info;
      } catch (err) {
        console.error(`❌ [EmailService - Resend API] Delivery Error for ${to}:`, err.message);
        throw err;
      }
    }

    if (this.transporter) {
      try {
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
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`✅ [EmailService - SMTP] Password reset email delivered to ${to} (messageId: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
      } catch (err) {
        console.error(`❌ [EmailService - SMTP] Delivery Error for ${to}:`, err.message);
        throw err;
      }
    }

    console.log(`📨 [EmailService - DEV MODE] Email simulation for ${to}:`);
    console.log(`   From: ${formattedFrom}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Reset Link: ${resetLink}`);
    return { success: true, mode: 'dev-logged' };
  }
}

module.exports = new EmailService();
