const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { verifyFirebaseToken, requireAdmin, requireStaffOrAdmin } = require('../middleware/firebaseAuth.middleware');
const { publicOrderLimiter } = require('../middleware/rateLimiter');

// Create Order (POS / Website Checkout)
router.post('/', publicOrderLimiter, orderController.createOrder);

// Order Reads (Staff / Admin)
router.get('/next-sequence', orderController.getNextInvoicePreview);
router.get('/', verifyFirebaseToken, requireStaffOrAdmin, orderController.getOrders);
router.get('/:id', verifyFirebaseToken, requireStaffOrAdmin, orderController.getOrderById);

// Order Mutations (Staff / Admin)
router.put('/:id', verifyFirebaseToken, requireStaffOrAdmin, orderController.updateOrderStatus);
router.delete('/:id', verifyFirebaseToken, requireStaffOrAdmin, orderController.deleteOrder);

module.exports = router;
