const express = require('express');
const router = express.Router();
const { getDailyAnalytics, getSalesHistory } = require('../controllers/report.controller');
const { verifyFirebaseToken, requireStaffOrAdmin } = require('../middleware/firebaseAuth.middleware');

router.get('/daily', verifyFirebaseToken, requireStaffOrAdmin, getDailyAnalytics);
router.get('/history', verifyFirebaseToken, requireStaffOrAdmin, getSalesHistory);

module.exports = router;
