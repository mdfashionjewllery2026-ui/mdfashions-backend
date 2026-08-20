const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branch.controller');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/firebaseAuth.middleware');

router.get('/', branchController.getBranches);
router.get('/:id', branchController.getBranchById);
router.post('/', verifyFirebaseToken, requireAdmin, branchController.createBranch);
router.put('/:id', verifyFirebaseToken, requireAdmin, branchController.updateBranch);
router.delete('/:id', verifyFirebaseToken, requireAdmin, branchController.deleteBranch);

module.exports = router;
