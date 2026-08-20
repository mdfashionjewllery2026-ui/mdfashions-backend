const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');
const { verifyFirebaseToken, verifyOptionalAuth, requireAdmin, requireStaffOrAdmin } = require('../middleware/firebaseAuth.middleware');

// Public Category & Brand Reads
router.get('/categories', inventoryController.getCategories);
router.get('/brands', inventoryController.getBrands);

// Category & Brand Mutations (Staff & Admin)
router.post('/categories', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.addCategory);
router.put('/categories/:id', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.updateCategory);
router.delete('/categories/:id', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.deleteCategory);

router.post('/brands', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.addBrand);

// Public Barcode / QR Lookup (with Optional Staff Auth)
router.get('/barcode', verifyOptionalAuth, inventoryController.getProductByQRCode);
router.get('/barcode/:barcode', verifyOptionalAuth, inventoryController.getProductByQRCode);
router.get('/qrcode', verifyOptionalAuth, inventoryController.getProductByQRCode);
router.get('/qrcode/:qrcode', verifyOptionalAuth, inventoryController.getProductByQRCode);

// Public Product Reads (with Optional Staff Auth)
router.get('/', verifyOptionalAuth, inventoryController.getAllProducts);
router.get('/:id', verifyOptionalAuth, inventoryController.getProductById);

// Product Mutations (Staff & Admin)
router.post('/', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.addProduct);
router.put('/:id', verifyFirebaseToken, requireStaffOrAdmin, inventoryController.updateProduct);
router.delete('/:id', verifyFirebaseToken, requireAdmin, inventoryController.deleteProduct);

module.exports = router;
