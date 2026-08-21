const db = require('../config/db');

// Default showroom settings fallback
const DEFAULT_SHOWROOM = {
  name: 'MD FASHION',
  address: '5 R P.Jaya paradise chitra nagar, saravanampatti,coimbatore 641035',
  phone: '9944721243',
  phone2: '8015566770'
};

const DEFAULT_SHIPPING = {
  handlingFeeBracket1: 0,
  handlingFeeBracket2: 50,
  handlingFeeBracket3: 100,
  handlingFeeBracket4: 150,
  freeShippingThreshold: 500000,
  enableFreeShippingThreshold: false
};

const DEFAULT_CUSTOMIZATIONS = {
  attachments: [
    { name: 'Rope', price: 10 },
    { name: 'Back Chain', price: 50 },
    { name: 'No Attachment', price: 0 }
  ],
  customizedProducts: [],
  enabledCategoryIds: []
};

// GET setting by key
exports.getSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const [rows] = await db.query(`
      SELECT setting_key, setting_value, updated_at
      FROM settings
      WHERE setting_key = ?
    `, [key]);

    if (rows.length === 0) {
      if (key === 'showroom') {
        return res.json({ success: true, setting_key: 'showroom', setting_value: DEFAULT_SHOWROOM });
      }
      if (key === 'shipping') {
        return res.json({ success: true, setting_key: 'shipping', setting_value: DEFAULT_SHIPPING });
      }
      if (key === 'customizations') {
        return res.json({ success: true, setting_key: 'customizations', setting_value: DEFAULT_CUSTOMIZATIONS });
      }
      return res.status(404).json({ success: false, message: `Setting '${key}' not found` });
    }

    let val = rows[0].setting_value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch(e){}
    }

    res.json({ success: true, setting_key: rows[0].setting_key, setting_value: val, updated_at: rows[0].updated_at });
  } catch (error) {
    console.error('Error in getSetting:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch setting', error: error.message });
  }
};

// PUT update setting by key
exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const settingValue = req.body;

    if (!settingValue || typeof settingValue !== 'object') {
      return res.status(400).json({ success: false, message: 'Setting value object is required' });
    }

    const jsonStr = JSON.stringify(settingValue);

    const [existing] = await db.query('SELECT setting_key FROM settings WHERE setting_key = ?', [key]);
    if (existing.length > 0) {
      await db.query(`
        UPDATE settings
        SET setting_value = ?, updated_at = NOW()
        WHERE setting_key = ?
      `, [jsonStr, key]);
    } else {
      await db.query(`
        INSERT INTO settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, NOW())
      `, [key, jsonStr]);
    }

    res.json({ success: true, message: `Setting '${key}' updated successfully`, setting_key: key, setting_value: settingValue });
  } catch (error) {
    console.error('Error in updateSetting:', error);
    res.status(500).json({ success: false, message: 'Failed to update setting', error: error.message });
  }
};

// POST data cleanup for MySQL database
exports.cleanupData = async (req, res) => {
  try {
    const { collections } = req.body;
    if (!Array.isArray(collections) || collections.length === 0) {
      return res.status(400).json({ success: false, message: 'No collections specified for cleanup' });
    }

    const results = {};

    // 1. Orders & Invoices / Profit Tracker cleanup
    if (collections.includes('orders') || collections.includes('profit_tracker')) {
      const [itemsRes] = await db.query('DELETE FROM order_items');
      const [ordersRes] = await db.query('DELETE FROM orders');
      
      // Reset invoice sequence counter in settings
      await db.query('UPDATE settings SET setting_value = "0" WHERE setting_key = "invoice_sequence"');
      
      const ordersDeleted = ordersRes.affectedRows || 0;
      if (collections.includes('orders')) results.orders = ordersDeleted;
      if (collections.includes('profit_tracker')) results.profit_tracker = ordersDeleted;
    }

    // 2. Customers cleanup
    if (collections.includes('customers')) {
      const [custRes] = await db.query('DELETE FROM customers');
      results.customers = (custRes.affectedRows || 0);
    }

    // 3. Packing Queue / Shipping Queue cleanup
    if (collections.includes('packing_queue')) {
      results.packing_queue = results.orders || 0;
    }
    if (collections.includes('shipping_queue')) {
      results.shipping_queue = results.orders || 0;
    }

    // 4. Staff accounts cleanup (preserves Admin ID 1)
    if (collections.includes('staff')) {
      const [staffRes] = await db.query('DELETE FROM users WHERE role <> "ADMIN" AND id <> 1');
      results.staff = (staffRes.affectedRows || 0);
    }

    res.json({
      success: true,
      message: 'Data cleanup completed successfully in MySQL database',
      results
    });
  } catch (error) {
    console.error('Error in cleanupData:', error);
    res.status(500).json({ success: false, message: 'Data cleanup failed', error: error.message });
  }
};
