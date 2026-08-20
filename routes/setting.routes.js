const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { verifyFirebaseToken, requireStaffOrAdmin } = require('../middleware/firebaseAuth.middleware');

// Protected data cleanup
router.post('/cleanup', verifyFirebaseToken, requireStaffOrAdmin, settingController.cleanupData);

// Public or protected read
router.get('/:key', settingController.getSetting);

// Protected update
router.put('/:key', verifyFirebaseToken, requireStaffOrAdmin, settingController.updateSetting);

module.exports = router;
