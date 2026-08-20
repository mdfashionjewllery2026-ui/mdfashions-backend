const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');
const { verifyFirebaseToken, requireAdmin, requireStaffOrAdmin } = require('../middleware/firebaseAuth.middleware');

// Public / Billing Customer Lookups & Creation
router.get('/phone/:mobile', customerController.getCustomerByPhone);
router.post('/', customerController.createCustomer);

// Protected Customer Management (Staff/Admin for list/update, Admin only for delete)
router.get('/', verifyFirebaseToken, requireStaffOrAdmin, customerController.getCustomers);
router.put('/:id', verifyFirebaseToken, requireStaffOrAdmin, customerController.updateCustomer);
router.delete('/:id', verifyFirebaseToken, requireAdmin, customerController.deleteCustomer);

module.exports = router;
