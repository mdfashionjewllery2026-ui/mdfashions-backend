const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplier.controller');
const { verifyFirebaseToken, requireStaffOrAdmin, requireAdmin } = require('../middleware/firebaseAuth.middleware');

// Protected supplier management routes
router.get('/', verifyFirebaseToken, requireStaffOrAdmin, supplierController.getSuppliers);
router.get('/:id', verifyFirebaseToken, requireStaffOrAdmin, supplierController.getSupplierById);
router.post('/', verifyFirebaseToken, requireStaffOrAdmin, supplierController.createSupplier);
router.put('/:id', verifyFirebaseToken, requireStaffOrAdmin, supplierController.updateSupplier);
router.delete('/:id', verifyFirebaseToken, requireAdmin, supplierController.deleteSupplier);

module.exports = router;
