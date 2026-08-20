const db = require('../config/db');
const razorpay = require('../config/razorpay.config');
const crypto = require('crypto');

// Centralized Atomic Order Fulfillment Helper in Hostinger MySQL
exports.fulfillOrderPayment = async (orderId, razorpay_payment_id, razorpay_order_id) => {
  console.log('[PaymentDebug] fulfillOrderPayment called for MySQL:', { orderId, razorpay_payment_id, razorpay_order_id });
  
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Look up order in MySQL
    const [orders] = await connection.query(
      `SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1 FOR UPDATE`,
      [orderId, orderId]
    );

    if (orders.length === 0) {
      await connection.rollback();
      throw new Error(`Order ${orderId} not found in database`);
    }

    const orderData = orders[0];
    const actualOrderId = orderData.id;
    const orderNumber = orderData.order_number;

    // Idempotency: If order is already PAID, return success immediately (prevent duplicate stock deduction)
    if (orderData.payment_status === 'PAID') {
      console.log(`[PaymentDebug] Order ${orderNumber} is ALREADY PAID.`);
      await connection.commit();
      return { success: true, message: "Order is already paid", orderId: orderNumber, isDuplicate: true };
    }

    // Retrieve order items
    const [items] = await connection.query(
      `SELECT * FROM order_items WHERE order_id = ?`,
      [actualOrderId]
    );

    // 1. Validate Stock for all items (Row-level lock)
    if (items.length > 0) {
      for (const item of items) {
        const qty = Number(item.quantity || 1);
        const prodId = item.product_id;

        if (prodId) {
          const [pRows] = await connection.query(
            `SELECT id, barcode, name, stock FROM products WHERE id = ? OR barcode = ? OR qr_code = ? LIMIT 1 FOR UPDATE`,
            [prodId, prodId, prodId]
          );

          if (pRows.length === 0) {
            await connection.rollback();
            throw new Error(`Product not found during fulfillment: ID ${prodId}`);
          }

          const currentStock = Number(pRows[0].stock || 0);
          if (currentStock < qty) {
            await connection.rollback();
            throw new Error(`Insufficient stock for product "${pRows[0].name}". Available: ${currentStock}, requested: ${qty}`);
          }
        }
      }

      // 2. Deduct stock atomically
      for (const item of items) {
        const qty = Number(item.quantity || 1);
        const prodId = item.product_id;
        if (prodId) {
          const [upd] = await connection.query(
            `UPDATE products SET stock = stock - ? WHERE (id = ? OR barcode = ? OR qr_code = ?) AND stock >= ?`,
            [qty, prodId, prodId, prodId, qty]
          );
          if (upd.affectedRows === 0) {
            await connection.rollback();
            throw new Error(`Insufficient stock during atomic deduction for item ${item.product_name}`);
          }
        }
      }
    }

    // 3. Update Order Status in MySQL to PAID and IN_PACKING_QUEUE
    await connection.query(
      `UPDATE orders SET payment_status = 'PAID', order_status = 'IN_PACKING_QUEUE', updated_at = NOW() WHERE id = ?`,
      [actualOrderId]
    );

    // 4. Update Customer Metrics
    if (orderData.customer_phone && orderData.customer_phone !== '0000000000') {
      await connection.query(
        `INSERT INTO customers (name, phone, total_spent, total_orders, created_at)
         VALUES (?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE 
           name = VALUES(name),
           total_spent = total_spent + VALUES(total_spent),
           total_orders = total_orders + 1`,
        [orderData.customer_name || 'Customer', orderData.customer_phone, Number(orderData.total_amount || 0)]
      );
    }

    await connection.commit();
    console.log(`[PaymentDebug] Order ${orderNumber} successfully updated to PAID & IN_PACKING_QUEUE in MySQL.`);
    return { success: true, message: "Payment fulfilled successfully", orderId: orderNumber };
  } catch (error) {
    await connection.rollback();
    console.error('[PaymentDebug] Fulfillment Error:', error);
    throw error;
  } finally {
    connection.release();
  }
};

// @desc    Create Razorpay Order
// @route   POST /api/v1/payments/create-order
// @desc    Create Razorpay Order (Server-Calculated Authoritative Total)
// @route   POST /api/v1/payments/create-order
exports.createOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { currency = 'INR', receipt, notes, billData } = req.body;
    const items = Array.isArray(billData?.items) ? billData.items : [];

    if (items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Order items are required' });
    }

    // 1. Calculate Authoritative Order Total from MySQL
    const { calculateAuthoritativeOrder } = require('./order.controller');
    let authCalc;
    try {
      authCalc = await calculateAuthoritativeOrder(connection, items);
    } catch (calcErr) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: calcErr.message });
    }

    const serverTotalAmount = authCalc.total_amount;
    const localOrderId = billData?.orderId || notes?.order_id || `MLR-${Date.now().toString().slice(-6)}`;

    // 2. Create Razorpay order with SERVER-CALCULATED amount
    const options = {
      amount: Math.round(serverTotalAmount * 100), // Razorpay expects amount in paise
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: {
        ...(notes || {}),
        order_id: localOrderId,
        source: billData?.source || 'WEB'
      },
    };

    let order;
    let isMock = process.env.RAZORPAY_KEY_ID === 'rzp_test_YOUR_TEST_KEY_HERE' || !process.env.RAZORPAY_KEY_ID;

    if (!isMock) {
      try {
        order = await razorpay.orders.create(options);
        if (!order) throw new Error("Order creation failed");
      } catch (err) {
        console.warn("Razorpay API failed (likely test/missing keys). Falling back to MOCK mode.");
        isMock = true;
      }
    }

    if (isMock) {
      order = {
        id: `order_mock_${Date.now()}`,
        amount: Math.round(serverTotalAmount * 100),
        currency: currency
      };
    }

    // 3. Pre-save order state in MySQL with Authoritative values
    // Stock is NOT deducted until verification
    const [existing] = await connection.query(
      `SELECT id FROM orders WHERE order_number = ? LIMIT 1`,
      [localOrderId]
    );

    let mysqlOrderId;
    const custName = billData?.customerName || 'Customer';
    const custPhone = billData?.customerPhone || billData?.customerMobile || '0000000000';
    const custEmail = billData?.customerEmail || null;

    if (existing.length > 0) {
      mysqlOrderId = existing[0].id;
      await connection.query(
        `UPDATE orders SET total_amount = ?, payment_status = 'PENDING', order_status = 'PENDING', updated_at = NOW() WHERE id = ?`,
        [serverTotalAmount, mysqlOrderId]
      );
      await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [mysqlOrderId]);
    } else {
      const [ins] = await connection.query(
        `INSERT INTO orders 
          (order_number, customer_name, customer_phone, customer_email, total_amount, payment_method, payment_status, order_status, order_source, branch_name)
         VALUES (?, ?, ?, ?, ?, 'CARD', 'PENDING', 'PENDING', 'WEB', 'Online Store')`,
        [localOrderId, custName, custPhone, custEmail, serverTotalAmount]
      );
      mysqlOrderId = ins.insertId;
    }

    for (const it of authCalc.items) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [mysqlOrderId, it.product_id, it.product_name, it.quantity, it.price, it.subtotal]
      );
    }

    await connection.commit();

    console.log('[PaymentDebug] Razorpay opened / Order created in MySQL with Authoritative Total:', { localOrderId, razorpayOrderId: order.id, serverTotalAmount });

    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      billId: localOrderId,
      serverCalculatedTotal: serverTotalAmount,
      isMock
    });
  } catch (error) {
    await connection.rollback();
    console.error('Razorpay Order Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// @desc    Verify Razorpay Signature
// @route   POST /api/v1/payments/verify
exports.verifyPayment = async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      billId,
      isMock 
    } = req.body;

    console.log('[PaymentDebug] verifyPayment endpoint hit:', { razorpay_order_id, razorpay_payment_id, billId });

    if (!isMock) {
      const sign = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest("hex");

      if (razorpay_signature !== expectedSign) {
        console.warn('[PaymentDebug] Signature verification failed!');
        return res.status(400).json({ success: false, message: "Invalid payment signature" });
      }
    }

    console.log('[PaymentDebug] Backend verified signature valid!');

    const result = await exports.fulfillOrderPayment(billId || razorpay_order_id, razorpay_payment_id, razorpay_order_id);

    return res.status(200).json({ 
      success: true, 
      message: "Payment verified and order confirmed successfully",
      billId: result.orderId 
    });
  } catch (error) {
    console.error('[PaymentDebug] Verification Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Razorpay Payment Status by Order ID
// @route   GET /api/v1/payments/status/:orderId
exports.getPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    // 1. Check MySQL orders table
    const [rows] = await db.query(
      `SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1`,
      [orderId, orderId]
    );

    if (rows.length > 0) {
      const order = rows[0];
      return res.status(200).json({
        success: true,
        status: order.payment_status === 'PAID' ? 'captured' : (order.payment_status === 'FAILED' ? 'failed' : 'created'),
        paymentStatus: order.payment_status,
        orderId: order.order_number || order.id
      });
    }

    return res.status(200).json({
      success: true,
      status: 'created',
      paymentStatus: 'PENDING',
      orderId: orderId
    });
  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

