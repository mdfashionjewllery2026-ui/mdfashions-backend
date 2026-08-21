const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { forgotPasswordLimiter } = require('../middleware/rateLimiter');

// Public password reset request endpoint
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);

module.exports = router;
