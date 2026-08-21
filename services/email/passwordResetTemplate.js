/**
 * Professional Branded Password Reset Email Template for MD Fashions
 */

function generatePasswordResetEmail({ resetLink, recipientEmail }) {
  const brandName = 'MD Fashions';
  const supportUrl = 'https://mdfashions.in';
  const currentYear = new Date().getFullYear();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your MD Fashions password</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #FAFAFA;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #2D3748;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #FAFAFA;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(212, 83, 126, 0.08);
      border: 1px solid #FCE7F3;
    }
    .header {
      background: linear-gradient(135deg, #4B1528 0%, #D4537E 100%);
      padding: 35px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      color: #FFFFFF;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .header p {
      margin: 6px 0 0 0;
      color: #FCE7F3;
      font-size: 11px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .content {
      padding: 35px 35px 30px 35px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 700;
      color: #1A202C;
      margin-bottom: 16px;
    }
    .text {
      font-size: 14px;
      line-height: 1.6;
      color: #4A5568;
      margin-bottom: 24px;
    }
    .btn-container {
      text-align: center;
      margin: 30px 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #D4537E 0%, #BE185D 100%);
      color: #FFFFFF !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 50px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 15px rgba(212, 83, 126, 0.35);
    }
    .security-notice {
      background-color: #FFF5F8;
      border: 1px solid #FCE7F3;
      border-radius: 12px;
      padding: 16px;
      margin-top: 25px;
      font-size: 12px;
      color: #702459;
      line-height: 1.5;
    }
    .footer {
      background-color: #FAFAFA;
      padding: 24px 35px;
      text-align: center;
      border-top: 1px solid #FCE7F3;
      font-size: 11px;
      color: #A0AEC0;
      line-height: 1.5;
    }
    .footer a {
      color: #D4537E;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>MD FASHIONS</h1>
        <p>Luxury Fashion Jewellery</p>
      </div>
      <div class="content">
        <div class="greeting">Hello,</div>
        <div class="text">
          We received a request to reset the password for your MD Fashions account. Click the button below to choose a new password:
        </div>
        <div class="btn-container">
          <a href="${resetLink}" class="btn" target="_blank">RESET PASSWORD</a>
        </div>
        <div class="security-notice">
          <strong>Security Notice:</strong>
          <br>• This password reset link is secure and will expire in 1 hour.
          <br>• If you did not request a password reset, you can safely ignore this email — your account remains fully secure.
          <br>• Never share this email or link with anyone.
        </div>
      </div>
      <div class="footer">
        © ${currentYear} MD Fashions Jewellery. All rights reserved.
        <br>Visit us at <a href="${supportUrl}">mdfashions.in</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const text = `MD FASHIONS — LUXURY FASHION JEWELLERY

Hello,

We received a request to reset the password for your MD Fashions account.

Please use the following link to reset your password:
${resetLink}

This link is valid for 1 hour. If you did not request this password reset, you can safely ignore this email.

For security, never share this link with anyone.

Regards,
MD Fashions Team
https://mdfashions.in
`;

  return { html, text, subject: 'Reset your MD Fashions password' };
}

module.exports = { generatePasswordResetEmail };
