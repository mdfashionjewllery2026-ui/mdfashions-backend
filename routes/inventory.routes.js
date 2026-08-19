const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

router.get('/', verifyToken, inventoryController.getAllProducts);
router.get('/barcode', inventoryController.getProductByQRCode);
router.get('/barcode/:barcode', inventoryController.getProductByQRCode);
router.get('/qrcode', inventoryController.getProductByQRCode);
router.get('/qrcode/:qrcode', inventoryController.getProductByQRCode);
router.post('/', [verifyToken, checkRole(['admin', 'manager'])], inventoryController.addProduct);
router.put('/:id', [verifyToken, checkRole(['admin', 'manager'])], inventoryController.updateProduct);
router.delete('/:id', [verifyToken, checkRole(['admin', 'manager'])], inventoryController.deleteProduct);

module.exports = router;
