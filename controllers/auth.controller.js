const { admin } = require('../config/firebase.config');
const emailService = require('../services/emailService');

// In-memory per-email cooldown (60 seconds) to prevent spamming
const emailCooldowns = new Map();

/**
 * @desc    Request a branded password reset email (Anti-Enumeration Protected)
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  const genericSuccessResponse = {
    success: true,
    message: "If an account exists for this email address, a password reset link has been sent."
  };

  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    // 1. Email validation
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address."
      });
    }

    // 2. Cooldown check (max 1 reset request every 60s per email address)
    const now = Date.now();
    const lastSent = emailCooldowns.get(normalizedEmail);
    if (lastSent && (now - lastSent) < 60000) {
      return res.status(200).json(genericSuccessResponse);
    }
    emailCooldowns.set(normalizedEmail, now);

    // Clean up old entries
    if (emailCooldowns.size > 200) {
      for (const [k, v] of emailCooldowns.entries()) {
        if (now - v > 300000) emailCooldowns.delete(k);
      }
    }

    // 3. Generate Firebase password reset link via Admin SDK
    const actionUrl = process.env.PASSWORD_RESET_URL || 'https://mdfashions.in/reset-password';
    const actionCodeSettings = {
      url: actionUrl,
      handleCodeInApp: true
    };

    let resetLink;
    try {
      if (admin && admin.auth && typeof admin.auth === 'function') {
        resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail, actionCodeSettings);
      } else {
        console.warn('[ForgotPassword] Firebase Admin Auth is unavailable.');
        return res.status(200).json(genericSuccessResponse);
      }
    } catch (fbError) {
      if (fbError.code === 'auth/user-not-found') {
        console.log(`[ForgotPassword] User not registered in Firebase: ${normalizedEmail}`);
      } else {
        console.warn(`[ForgotPassword] Firebase Admin link generation note for ${normalizedEmail}:`, fbError.message);
      }
      return res.status(200).json(genericSuccessResponse);
    }

    // 4. Send branded email via EmailService
    if (resetLink) {
      try {
        await emailService.sendPasswordResetMail({
          to: normalizedEmail,
          resetLink
        });
      } catch (mailError) {
        console.error('[ForgotPassword] Email transmission error:', mailError.message);
      }
    }

    return res.status(200).json(genericSuccessResponse);
  } catch (err) {
    console.error('[ForgotPassword] Unexpected Controller Error:', err.message);
    return res.status(200).json(genericSuccessResponse);
  }
};
