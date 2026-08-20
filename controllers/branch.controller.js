const db = require('../config/db');

// @desc    Get All Branches
// @route   GET /api/v1/branches
// @access  Protected (verifyFirebaseToken)
exports.getBranches = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM branches ORDER BY id DESC');
    const branches = rows.map(b => {
      let parsedPermissions = null;
      if (b.permissions) {
        try {
          parsedPermissions = typeof b.permissions === 'string' ? JSON.parse(b.permissions) : b.permissions;
        } catch (e) {
          parsedPermissions = null;
        }
      }
      return {
        ...b,
        permissions: parsedPermissions
      };
    });

    res.status(200).json({
      success: true,
      count: branches.length,
      branches
    });
  } catch (error) {
    console.error('Get Branches Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Branch by ID
// @route   GET /api/v1/branches/:id
// @access  Protected (verifyFirebaseToken)
exports.getBranchById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM branches WHERE id = ? LIMIT 1', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    const branch = rows[0];
    if (branch.permissions) {
      try {
        branch.permissions = typeof branch.permissions === 'string' ? JSON.parse(branch.permissions) : branch.permissions;
      } catch (e) {}
    }

    res.status(200).json({
      success: true,
      branch
    });
  } catch (error) {
    console.error('Get Branch By ID Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create New Branch
// @route   POST /api/v1/branches
// @access  Protected (Admin / Owner)
exports.createBranch = async (req, res) => {
  try {
    const { name, code, phone, phone2, email, address, manager, status, permissions } = req.body;

    const trimmedName = (name || '').trim();
    const trimmedCode = (code || '').trim();

    if (!trimmedName || !trimmedCode) {
      return res.status(400).json({
        success: false,
        message: 'Branch Name and Branch Code are required.'
      });
    }

    // Check code uniqueness
    const [existing] = await db.query('SELECT id FROM branches WHERE LOWER(code) = LOWER(?) LIMIT 1', [trimmedCode]);
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `A branch with code "${trimmedCode}" already exists.`
      });
    }

    const permissionsJson = permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : null;
    const branchStatus = status || 'Active';

    const [result] = await db.query(
      `INSERT INTO branches (name, code, phone, phone2, email, address, manager, status, permissions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trimmedName,
        trimmedCode,
        (phone || '').trim() || null,
        (phone2 || '').trim() || null,
        (email || '').trim() || null,
        (address || '').trim() || null,
        (manager || '').trim() || null,
        branchStatus,
        permissionsJson
      ]
    );

    const [newBranchRows] = await db.query('SELECT * FROM branches WHERE id = ?', [result.insertId]);
    const newBranch = newBranchRows[0];
    if (newBranch.permissions) {
      try { newBranch.permissions = JSON.parse(newBranch.permissions); } catch(e){}
    }

    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      branch: newBranch
    });
  } catch (error) {
    console.error('Create Branch Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update Branch
// @route   PUT /api/v1/branches/:id
// @access  Protected (Admin / Owner)
exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, phone, phone2, email, address, manager, status, permissions } = req.body;

    const [existing] = await db.query('SELECT * FROM branches WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    const currentBranch = existing[0];

    const updatedName = typeof name !== 'undefined' ? (name || '').trim() : currentBranch.name;
    const updatedCode = typeof code !== 'undefined' ? (code || '').trim() : currentBranch.code;

    if (!updatedName || !updatedCode) {
      return res.status(400).json({ success: false, message: 'Branch Name and Code cannot be empty.' });
    }

    // If code updated, check uniqueness
    if (updatedCode.toLowerCase() !== currentBranch.code.toLowerCase()) {
      const [dup] = await db.query('SELECT id FROM branches WHERE LOWER(code) = LOWER(?) AND id <> ? LIMIT 1', [updatedCode, id]);
      if (dup.length > 0) {
        return res.status(409).json({ success: false, message: `A branch with code "${updatedCode}" already exists.` });
      }
    }

    const updatedPhone = typeof phone !== 'undefined' ? (phone || '').trim() || null : currentBranch.phone;
    const updatedPhone2 = typeof phone2 !== 'undefined' ? (phone2 || '').trim() || null : currentBranch.phone2;
    const updatedEmail = typeof email !== 'undefined' ? (email || '').trim() || null : currentBranch.email;
    const updatedAddress = typeof address !== 'undefined' ? (address || '').trim() || null : currentBranch.address;
    const updatedManager = typeof manager !== 'undefined' ? (manager || '').trim() || null : currentBranch.manager;
    const updatedStatus = typeof status !== 'undefined' ? status : currentBranch.status;
    let updatedPermissions;
    if (typeof permissions !== 'undefined') {
      updatedPermissions = permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : null;
    } else if (currentBranch.permissions) {
      updatedPermissions = typeof currentBranch.permissions === 'string' ? currentBranch.permissions : JSON.stringify(currentBranch.permissions);
    } else {
      updatedPermissions = null;
    }

    await db.query(
      `UPDATE branches SET 
        name = ?, code = ?, phone = ?, phone2 = ?, email = ?, address = ?, manager = ?, status = ?, permissions = ?
       WHERE id = ?`,
      [
        updatedName,
        updatedCode,
        updatedPhone,
        updatedPhone2,
        updatedEmail,
        updatedAddress,
        updatedManager,
        updatedStatus,
        updatedPermissions,
        id
      ]
    );

    const [updatedRows] = await db.query('SELECT * FROM branches WHERE id = ?', [id]);
    const updatedBranch = updatedRows[0];
    if (updatedBranch.permissions) {
      try { updatedBranch.permissions = JSON.parse(updatedBranch.permissions); } catch(e){}
    }

    res.status(200).json({
      success: true,
      message: 'Branch updated successfully',
      branch: updatedBranch
    });
  } catch (error) {
    console.error('Update Branch Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete Branch
// @route   DELETE /api/v1/branches/:id
// @access  Protected (Admin / Owner)
exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT id FROM branches WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    await db.query('DELETE FROM branches WHERE id = ?', [id]);

    res.status(200).json({
      success: true,
      message: 'Branch deleted successfully'
    });
  } catch (error) {
    console.error('Delete Branch Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
