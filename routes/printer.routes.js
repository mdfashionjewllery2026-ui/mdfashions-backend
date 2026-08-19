const express = require('express');
const router = express.Router();
const printerController = require('../controllers/printer.controller');

router.get('/status', (req, res) => printerController.checkStatus(req, res));
router.post('/test', (req, res) => printerController.printTest(req, res));
router.post('/print', (req, res) => printerController.printReceipt(req, res));

module.exports = router;
