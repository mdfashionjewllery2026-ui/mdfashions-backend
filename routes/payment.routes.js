const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, getPaymentStatus } = require('../controllers/payment.controller');
const { handleWebhook } = require('../controllers/webhook.controller');
const { publicOrderLimiter } = require('../middleware/rateLimiter');

router.post('/create-order', publicOrderLimiter, createOrder);
router.get('/status/:orderId', getPaymentStatus);
router.post('/verify', verifyPayment);
router.post('/webhook', handleWebhook);

module.exports = router;
