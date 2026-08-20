const express = require('express');
const router = express.Router();
const excelController = require('../controllers/excel.controller');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth.middleware');

// Support both GET (for server-querying) and POST (for client-passed dataset fallback)
router.get('/export', verifyFirebaseToken, excelController.exportExcelReport);
router.post('/export', verifyFirebaseToken, excelController.exportExcelReport);

module.exports = router;
