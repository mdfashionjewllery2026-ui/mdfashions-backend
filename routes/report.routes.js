const express = require('express');
const router = express.Router();
const { getDailyAnalytics, getSalesHistory } = require('../controllers/report.controller');

router.get('/daily', getDailyAnalytics);
router.get('/history', getSalesHistory);

module.exports = router;
