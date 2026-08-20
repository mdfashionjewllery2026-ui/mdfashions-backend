const db = require('../config/db');

// @desc    Create Customer
// @route   POST /api/v1/customers
exports.createCustomer = async (req, res) => {
  try {
    const { name, mobile, phone, email, address } = req.body;
    const custPhone = phone || mobile;
    const [result] = await db.query(
      `INSERT INTO customers (name, phone, email, address)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         name = VALUES(name),
         email = VALUES(email),
         address = VALUES(address)`,
      [name, custPhone, email || null, address || null]
    );

    res.status(201).json({
      success: true,
      customer: {
        id: result.insertId,
        name,
        phone: custPhone,
        mobile: custPhone,
        email,
        address
      }
    });
  } catch (error) {
    console.error('Create Customer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Customers
// @route   GET /api/v1/customers
exports.getCustomers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.*,
        COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_amount ELSE 0 END), 0) AS live_total_spent,
        COUNT(CASE WHEN o.payment_status = 'PAID' THEN o.id ELSE NULL END) AS live_total_orders
      FROM customers c
      LEFT JOIN orders o ON (o.customer_phone = c.phone OR (o.customer_id IS NOT NULL AND o.customer_id = c.id))
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    const customers = rows.map(c => {
      const liveSpent = Number(c.live_total_spent || 0);
      const liveOrders = Number(c.live_total_orders || 0);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone || '',
        mobile: c.phone || '',
        email: c.email || '',
        address: c.address || '',
        city: c.city || '',
        totalSpent: liveSpent,
        total_spent: liveSpent,
        totalOrders: liveOrders,
        total_orders: liveOrders,
        createdAt: c.created_at
      };
    });

    res.status(200).json({
      success: true,
      customers
    });
  } catch (error) {
    console.error('Get Customers Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Customer by Phone
// @route   GET /api/v1/customers/phone/:mobile
exports.getCustomerByPhone = async (req, res) => {
  try {
    const { mobile } = req.params;
    const [rows] = await db.query(`
      SELECT 
        c.*,
        COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_amount ELSE 0 END), 0) AS live_total_spent,
        COUNT(CASE WHEN o.payment_status = 'PAID' THEN o.id ELSE NULL END) AS live_total_orders
      FROM customers c
      LEFT JOIN orders o ON (o.customer_phone = c.phone OR (o.customer_id IS NOT NULL AND o.customer_id = c.id))
      WHERE c.phone = ?
      GROUP BY c.id
      LIMIT 1
    `, [mobile]);

    if (rows.length > 0) {
      const c = rows[0];
      const liveSpent = Number(c.live_total_spent || 0);
      const liveOrders = Number(c.live_total_orders || 0);
      res.status(200).json({ 
        success: true, 
        customer: {
          ...c,
          phone: c.phone || '',
          mobile: c.phone || '',
          totalSpent: liveSpent,
          total_spent: liveSpent,
          totalOrders: liveOrders,
          total_orders: liveOrders
        } 
      });
    } else {
      res.status(404).json({ success: false, message: 'Customer not found' });
    }
  } catch (error) {
    console.error('Get Customer By Phone Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// @desc    Update Customer
// @route   PUT /api/v1/customers/:id
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, phone, email, address } = req.body;
    const custPhone = phone || mobile;

    await db.query(
      `UPDATE customers SET 
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address)
       WHERE id = ?`,
      [name || null, custPhone || null, email || null, address || null, id]
    );

    res.status(200).json({ success: true, message: 'Customer updated successfully' });
  } catch (error) {
    console.error('Update Customer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete Customer
// @route   DELETE /api/v1/customers/:id
exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM customers WHERE id = ?`, [id]);
    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Delete Customer Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
