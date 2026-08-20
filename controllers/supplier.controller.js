const db = require('../config/db');

// GET all suppliers
exports.getSuppliers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, category, location, contact, email, website, notes, created_at, updated_at
      FROM suppliers
      ORDER BY created_at DESC
    `);
    res.json({ success: true, suppliers: rows, count: rows.length });
  } catch (error) {
    console.error('Error in getSuppliers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers', error: error.message });
  }
};

// GET supplier by ID
exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`
      SELECT id, name, category, location, contact, email, website, notes, created_at, updated_at
      FROM suppliers
      WHERE id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    res.json({ success: true, supplier: rows[0] });
  } catch (error) {
    console.error('Error in getSupplierById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch supplier', error: error.message });
  }
};

// POST create supplier
exports.createSupplier = async (req, res) => {
  try {
    const { id, name, category, location, contact, email, website, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier name is required' });
    }

    const supplierId = id || `SUP-${Date.now()}`;
    const safeCategory = category || 'Gold';
    const safeLocation = location || '';
    const safeContact = contact || '';
    const safeEmail = email || '';
    const safeWebsite = website || '';
    const safeNotes = notes || '';

    // Check duplicate ID
    const [existing] = await db.query('SELECT id FROM suppliers WHERE id = ?', [supplierId]);
    if (existing.length > 0) {
      // Update instead of error if migrating
      await db.query(`
        UPDATE suppliers
        SET name = ?, category = ?, location = ?, contact = ?, email = ?, website = ?, notes = ?, updated_at = NOW()
        WHERE id = ?
      `, [name.trim(), safeCategory, safeLocation, safeContact, safeEmail, safeWebsite, safeNotes, supplierId]);

      const [updated] = await db.query('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
      return res.status(200).json({ success: true, message: 'Supplier updated', supplier: updated[0] });
    }

    await db.query(`
      INSERT INTO suppliers (id, name, category, location, contact, email, website, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [supplierId, name.trim(), safeCategory, safeLocation, safeContact, safeEmail, safeWebsite, safeNotes]);

    const [created] = await db.query('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
    res.status(201).json({ success: true, message: 'Supplier created successfully', supplier: created[0] });
  } catch (error) {
    console.error('Error in createSupplier:', error);
    res.status(500).json({ success: false, message: 'Failed to create supplier', error: error.message });
  }
};

// PUT update supplier
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, location, contact, email, website, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier name is required' });
    }

    const [existing] = await db.query('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    await db.query(`
      UPDATE suppliers
      SET name = ?, category = ?, location = ?, contact = ?, email = ?, website = ?, notes = ?, updated_at = NOW()
      WHERE id = ?
    `, [name.trim(), category || 'Gold', location || '', contact || '', email || '', website || '', notes || '', id]);

    const [updated] = await db.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true, message: 'Supplier updated successfully', supplier: updated[0] });
  } catch (error) {
    console.error('Error in updateSupplier:', error);
    res.status(500).json({ success: false, message: 'Failed to update supplier', error: error.message });
  }
};

// DELETE supplier
exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    await db.query('DELETE FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true, message: 'Supplier deleted successfully', id });
  } catch (error) {
    console.error('Error in deleteSupplier:', error);
    res.status(500).json({ success: false, message: 'Failed to delete supplier', error: error.message });
  }
};
