const db = require('../config/db');

// Helper: Atomically allocate next sequential invoice number in MySQL
const getNextInvoiceNumber = async (connection) => {
  // Ensure the invoice_sequence setting exists
  await connection.query(
    `INSERT INTO settings (setting_key, setting_value) 
     VALUES ('invoice_sequence', '0') 
     ON DUPLICATE KEY UPDATE setting_key = setting_key`
  );

  // Atomically increment the sequence counter
  await connection.query(
    `UPDATE settings 
     SET setting_value = CAST(setting_value AS UNSIGNED) + 1 
     WHERE setting_key = 'invoice_sequence'`
  );

  // Read the incremented sequence value
  const [rows] = await connection.query(
    `SELECT setting_value FROM settings WHERE setting_key = 'invoice_sequence' LIMIT 1 FOR UPDATE`
  );

  const seqNum = parseInt(rows[0]?.setting_value || '1', 10);
  const padded = String(seqNum).padStart(3, '0');
  return `MDF-${padded}`;
};

// Helper: Calculate Authoritative Order Pricing, Customizations, Subtotal, Shipping, and Total from MySQL
const calculateAuthoritativeOrder = async (connection, items) => {
  const parsedItems = Array.isArray(items) ? items : [];
  let calculatedSubtotal = 0;
  const processedItems = [];

  for (const item of parsedItems) {
    const qty = Math.max(1, Number(item.quantity || item.cartQuantity || 1));
    const prodId = item.id || item.dbProductId || item.productId;

    if (!prodId) {
      const idErr = new Error(`Product identifier missing in order line items`);
      idErr.code = 'INVALID_PRODUCT_ID';
      throw idErr;
    }

    const [pRows] = await connection.query(
      `SELECT id, barcode, qr_code, name, price, stock, category, is_active FROM products WHERE id = ? OR barcode = ? OR qr_code = ? LIMIT 1 FOR UPDATE`,
      [prodId, prodId, prodId]
    );

    if (pRows.length === 0) {
      const notFoundErr = new Error(`Product not found in catalogue: ${item.productName || item.name || prodId}`);
      notFoundErr.code = 'PRODUCT_NOT_FOUND';
      throw notFoundErr;
    }

    const dbProd = pRows[0];

    if (dbProd.is_active === 0) {
      const inactiveErr = new Error(`Product is currently inactive: ${dbProd.name}`);
      inactiveErr.code = 'PRODUCT_INACTIVE';
      throw inactiveErr;
    }

    const baseUnitPrice = Number(dbProd.price || 0);

    // Authoritative Customization Pricing: Back Chain (+₹50), Rope (+₹10)
    let customizationCharge = 0;
    const att = item.selectedAttachment || item.attachment;
    const attName = (typeof att === 'string' ? att : (att?.name || '')).toLowerCase().trim();
    if (attName.includes('back chain')) {
      customizationCharge = 50;
    } else if (attName.includes('rope')) {
      customizationCharge = 10;
    }

    const finalUnitPrice = baseUnitPrice + customizationCharge;
    const lineSubtotal = finalUnitPrice * qty;
    calculatedSubtotal += lineSubtotal;

    processedItems.push({
      product_id: dbProd.id,
      product_name: dbProd.name,
      base_price: baseUnitPrice,
      customization_charge: customizationCharge,
      price: finalUnitPrice,
      quantity: qty,
      subtotal: lineSubtotal,
      stock: Number(dbProd.stock || 0),
      category: dbProd.category
    });
  }

  // Shipping calculation from MySQL categories
  const [categories] = await connection.query(
    `SELECT name, shipping_charge, free_delivery FROM categories WHERE status = 'ACTIVE' OR status IS NULL`
  );

  const getCatShipping = (catName) => {
    const clean = (catName || '').toLowerCase().trim();
    if (!clean) return 0;
    const match = categories.find(c => (c.name || '').toLowerCase().trim() === clean);
    if (match) {
      if (match.free_delivery === 1 || match.free_delivery === true) return 0;
      return Number(match.shipping_charge || 0);
    }
    return 0;
  };

  const hasBridal = processedItems.some(item => (item.category || '').toLowerCase().trim().includes('bridal'));
  let baseShipping = 0;
  if (hasBridal) {
    baseShipping = getCatShipping('bridal');
  } else {
    baseShipping = processedItems.reduce((max, item) => {
      const charge = getCatShipping(item.category);
      return charge > max ? charge : max;
    }, 0);
  }

  const totalQty = processedItems.reduce((sum, it) => sum + it.quantity, 0);

  // Read Global Shipping Settings dynamically from MySQL settings table
  const [shipRows] = await connection.query(
    `SELECT setting_value FROM settings WHERE setting_key = 'shipping' LIMIT 1`
  );
  let shipConfig = {
    handlingFeeBracket1: 0,
    handlingFeeBracket2: 50,
    handlingFeeBracket3: 100,
    handlingFeeBracket4: 150,
    freeShippingThreshold: 500000,
    enableFreeShippingThreshold: false
  };
  if (shipRows.length > 0) {
    try {
      const parsed = typeof shipRows[0].setting_value === 'string' ? JSON.parse(shipRows[0].setting_value) : shipRows[0].setting_value;
      if (parsed) shipConfig = { ...shipConfig, ...parsed };
    } catch (_) {}
  }

  let handlingFee = 0;
  if (totalQty >= 1 && totalQty <= 5) {
    handlingFee = Number(shipConfig.handlingFeeBracket1 || 0);
  } else if (totalQty >= 6 && totalQty <= 10) {
    handlingFee = Number(shipConfig.handlingFeeBracket2 || 0);
  } else if (totalQty >= 11 && totalQty <= 20) {
    handlingFee = Number(shipConfig.handlingFeeBracket3 || 0);
  } else if (totalQty > 20) {
    handlingFee = Number(shipConfig.handlingFeeBracket4 || 0);
  }

  let calculatedShipping = baseShipping + handlingFee;

  if (shipConfig.enableFreeShippingThreshold && shipConfig.freeShippingThreshold > 0 && calculatedSubtotal >= shipConfig.freeShippingThreshold) {
    calculatedShipping = 0;
  }

  const calculatedTax = 0; // Tax is 0% (inclusive) in current MD Fashions business model
  const calculatedTotal = calculatedSubtotal + calculatedShipping + calculatedTax;

  return {
    subtotal: calculatedSubtotal,
    shipping: calculatedShipping,
    tax: calculatedTax,
    total_amount: calculatedTotal,
    items: processedItems
  };
};

exports.calculateAuthoritativeOrder = calculateAuthoritativeOrder;

// @desc    Get Next Invoice Number Preview
// @route   GET /api/v1/orders/next-sequence
exports.getNextInvoicePreview = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT setting_value FROM settings WHERE setting_key = 'invoice_sequence' LIMIT 1`
    );
    const currentSeq = rows.length > 0 ? parseInt(rows[0].setting_value || '0', 10) : 0;
    const nextSeq = currentSeq + 1;
    const padded = String(nextSeq).padStart(3, '0');
    res.status(200).json({
      success: true,
      next_invoice_number: `MDF-${padded}`,
      current_sequence: currentSeq
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create or Process an Order / Bill (Transactional & Idempotent)
// @route   POST /api/v1/orders
exports.createOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      invoice_id,
      order_number,
      customer_id,
      customer_name,
      customer_mobile,
      customer_phone,
      customer_email,
      subtotal,
      discount,
      tax,
      total_amount,
      payment_method,
      payment_status,
      order_status,
      order_source,
      branch_code,
      branchCode,
      branch_name,
      branchName,
      items
    } = req.body;

    let orderNum = order_number || invoice_id;
    let existingOrders = [];

    if (orderNum) {
      const [rows] = await connection.query(
        `SELECT * FROM orders WHERE order_number = ? LIMIT 1 FOR UPDATE`,
        [orderNum]
      );
      existingOrders = rows;
    }

    // If new order and not already a formatted MDF-XXX sequential number, generate next MDF-XXX
    if (existingOrders.length === 0) {
      if (!orderNum || !orderNum.startsWith('MDF-')) {
        orderNum = await getNextInvoiceNumber(connection);
      }
    }

    const custName = customer_name || 'Walk-in Customer';
    const custPhone = customer_phone || customer_mobile || '0000000000';
    const custEmail = customer_email || null;
    const payMethod = (payment_method || 'CASH').toUpperCase();
    const rawPayStatus = (payment_status || 'PENDING').toUpperCase();
    const orderSrc = (order_source || 'POS').toUpperCase();
    const bCode = branch_code || branchCode || (orderSrc === 'POS' ? 'MD-001' : null);
    const bName = branch_name || branchName || (orderSrc === 'POS' ? 'Saravanampatti' : 'Online Store');

    // Business-Safe Payment Status Resolution:
    // Web clients can NEVER dictate that an online payment is PAID.
    let resolvedPaymentStatus = rawPayStatus;
    if (orderSrc === 'WEB') {
      if (payMethod === 'COD') {
        resolvedPaymentStatus = 'PENDING';
      } else if (payMethod === 'UPI') {
        // Direct manual UPI QR scan lacks automated server-side bank verification
        // Must be recorded as PENDING until verified by merchant/staff
        resolvedPaymentStatus = 'PENDING';
      } else if (payMethod === 'CARD' || payMethod === 'ONLINE') {
        // Online card/gateway orders must be verified server-side through /payments/verify
        // If submitted directly here without server verification, enforce PENDING
        if (!req.user || !['admin', 'manager', 'staff'].includes(req.user.role?.toLowerCase())) {
          resolvedPaymentStatus = 'PENDING';
        }
      }
    }

    if (existingOrders.length > 0) {
      const existingOrder = existingOrders[0];
      // If already PAID, return success without duplicate stock deduction (Idempotency)
      if (existingOrder.payment_status === 'PAID') {
        await connection.commit();
        return res.status(200).json({
          success: true,
          message: 'Order is already paid and finalized',
          order: existingOrder,
          stockDeducted: false,
          isDuplicate: true
        });
      }

      // If existing order was PENDING and new status is NOT PAID (e.g. FAILED or CANCELLED)
      if (resolvedPaymentStatus !== 'PAID') {
        await connection.query(
          `UPDATE orders SET payment_status = ?, order_status = ?, updated_at = NOW() WHERE id = ?`,
          [resolvedPaymentStatus, resolvedPaymentStatus === 'FAILED' || resolvedPaymentStatus === 'CANCELLED' ? 'CANCELLED' : 'PENDING', existingOrder.id]
        );
        await connection.commit();
        return res.status(200).json({
          success: true,
          message: `Order updated to ${resolvedPaymentStatus}. No stock deducted.`,
          order: { ...existingOrder, payment_status: resolvedPaymentStatus },
          stockDeducted: false
        });
      }
    }

// Helper: Calculate Authoritative Order Pricing, Customizations, Subtotal, Shipping, and Total from MySQL
const calculateAuthoritativeOrder = async (connection, items) => {
  const parsedItems = Array.isArray(items) ? items : [];
  let calculatedSubtotal = 0;
  const processedItems = [];

  for (const item of parsedItems) {
    const qty = Math.max(1, Number(item.quantity || item.cartQuantity || 1));
    const prodId = item.id || item.dbProductId || item.productId;

    if (!prodId) {
      const idErr = new Error(`Product identifier missing in order line items`);
      idErr.code = 'INVALID_PRODUCT_ID';
      throw idErr;
    }

    const [pRows] = await connection.query(
      `SELECT id, barcode, qr_code, name, price, stock, category, is_active FROM products WHERE id = ? OR barcode = ? OR qr_code = ? LIMIT 1 FOR UPDATE`,
      [prodId, prodId, prodId]
    );

    if (pRows.length === 0) {
      const notFoundErr = new Error(`Product not found in catalogue: ${item.productName || item.name || prodId}`);
      notFoundErr.code = 'PRODUCT_NOT_FOUND';
      throw notFoundErr;
    }

    const dbProd = pRows[0];

    if (dbProd.is_active === 0) {
      const inactiveErr = new Error(`Product is currently inactive: ${dbProd.name}`);
      inactiveErr.code = 'PRODUCT_INACTIVE';
      throw inactiveErr;
    }

    const baseUnitPrice = Number(dbProd.price || 0);

    // Authoritative Customization Pricing: Back Chain (+₹50), Rope (+₹10)
    let customizationCharge = 0;
    const att = item.selectedAttachment || item.attachment;
    const attName = (typeof att === 'string' ? att : (att?.name || '')).toLowerCase().trim();
    if (attName.includes('back chain')) {
      customizationCharge = 50;
    } else if (attName.includes('rope')) {
      customizationCharge = 10;
    }

    const finalUnitPrice = baseUnitPrice + customizationCharge;
    const lineSubtotal = finalUnitPrice * qty;
    calculatedSubtotal += lineSubtotal;

    processedItems.push({
      product_id: dbProd.id,
      product_name: dbProd.name,
      base_price: baseUnitPrice,
      customization_charge: customizationCharge,
      price: finalUnitPrice,
      quantity: qty,
      subtotal: lineSubtotal,
      stock: Number(dbProd.stock || 0),
      category: dbProd.category
    });
  }

  // Shipping calculation from MySQL categories
  const [categories] = await connection.query(
    `SELECT name, shipping_charge, free_delivery FROM categories WHERE status = 'ACTIVE' OR status IS NULL`
  );

  const getCatShipping = (catName) => {
    const clean = (catName || '').toLowerCase().trim();
    if (!clean) return 0;
    const match = categories.find(c => (c.name || '').toLowerCase().trim() === clean);
    if (match) {
      if (match.free_delivery === 1 || match.free_delivery === true) return 0;
      return Number(match.shipping_charge || 0);
    }
    return 0;
  };

  const hasBridal = processedItems.some(item => (item.category || '').toLowerCase().trim().includes('bridal'));
  let baseShipping = 0;
  if (hasBridal) {
    baseShipping = getCatShipping('bridal');
  } else {
    baseShipping = processedItems.reduce((max, item) => {
      const charge = getCatShipping(item.category);
      return charge > max ? charge : max;
    }, 0);
  }

  const totalQty = processedItems.reduce((sum, it) => sum + it.quantity, 0);
  let handlingFee = 0;
  if (totalQty >= 1 && totalQty <= 5) {
    handlingFee = 0;
  } else if (totalQty >= 6 && totalQty <= 10) {
    handlingFee = 50;
  } else if (totalQty >= 11 && totalQty <= 20) {
    handlingFee = 100;
  } else if (totalQty > 20) {
    handlingFee = 150;
  }

  const calculatedShipping = baseShipping + handlingFee;
  const calculatedTax = 0; // Tax is 0% (inclusive) in current MD Fashions business model
  const calculatedTotal = calculatedSubtotal + calculatedShipping + calculatedTax;

  return {
    subtotal: calculatedSubtotal,
    shipping: calculatedShipping,
    tax: calculatedTax,
    total_amount: calculatedTotal,
    items: processedItems
  };
};

exports.calculateAuthoritativeOrder = calculateAuthoritativeOrder;

    // 2. Authoritative Price & Item Calculation from MySQL (Ignoring Client Values)
    let authCalculation = { subtotal: 0, shipping: 0, tax: 0, total_amount: 0, items: [] };
    if (Array.isArray(items) && items.length > 0) {
      try {
        authCalculation = await calculateAuthoritativeOrder(connection, items);
      } catch (calcErr) {
        await connection.rollback();
        const statusCode = calcErr.code === 'PRODUCT_NOT_FOUND' ? 404 : 400;
        return res.status(statusCode).json({
          success: false,
          code: calcErr.code || 'PRICE_CALCULATION_FAILED',
          message: calcErr.message
        });
      }
    }

    const totalAmt = authCalculation.total_amount;
    const isPaid = resolvedPaymentStatus === 'PAID';

    // 3. Validate Stock ONLY IF payment_status is 'PAID'
    if (isPaid && authCalculation.items.length > 0) {
      for (const item of authCalculation.items) {
        if (item.stock < item.quantity) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for product "${item.product_name}". Available: ${item.stock}, requested: ${item.quantity}`,
            productId: item.product_id,
            currentStock: item.stock,
            requestedQuantity: item.quantity
          });
        }
      }
    }

    // 4. Determine Order Status
    let computedOrderStatus = 'PENDING';
    if (isPaid) {
      computedOrderStatus = orderSrc === 'WEB' ? 'IN_PACKING_QUEUE' : 'SHIPPED';
    } else if (resolvedPaymentStatus === 'FAILED' || resolvedPaymentStatus === 'CANCELLED') {
      computedOrderStatus = 'CANCELLED';
    }

    // 5. Create or Update Order Header Record with Authoritative Values
    let orderId;
    if (existingOrders.length > 0) {
      orderId = existingOrders[0].id;
      await connection.query(
        `UPDATE orders SET 
          total_amount = ?, payment_method = ?, payment_status = ?, order_status = ?, branch_code = ?, branch_name = ?, updated_at = NOW()
         WHERE id = ?`,
        [totalAmt, payMethod, resolvedPaymentStatus, computedOrderStatus, bCode, bName, orderId]
      );
    } else {
      const [orderResult] = await connection.query(
        `INSERT INTO orders 
          (order_number, customer_id, customer_name, customer_phone, customer_email, total_amount, payment_method, payment_status, order_status, order_source, branch_code, branch_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNum,
          customer_id || null,
          custName,
          custPhone,
          custEmail,
          totalAmt,
          payMethod,
          resolvedPaymentStatus,
          computedOrderStatus,
          orderSrc,
          bCode,
          bName
        ]
      );
      orderId = orderResult.insertId;
    }

    // 6. Process Items & Deduct Stock ONLY IF PAID
    let stockDeducted = false;
    if (authCalculation.items.length > 0) {
      // Clear existing order items if updating order
      if (existingOrders.length > 0) {
        await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
      }

      for (const item of authCalculation.items) {
        await connection.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [orderId, item.product_id, item.product_name, item.quantity, item.price, item.subtotal]
        );

        // Deduct stock ONLY IF PAYMENT IS PAID
        if (isPaid && item.product_id) {
          const [upd] = await connection.query(
            `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
            [item.quantity, item.product_id, item.quantity]
          );

          if (upd.affectedRows === 0) {
            await connection.rollback();
            return res.status(409).json({
              success: false,
              code: 'INSUFFICIENT_STOCK',
              message: `Insufficient stock during atomic deduction for ${item.product_name}`
            });
          }
          stockDeducted = true;
        }
      }
    }

    // 6. Update Customer metrics ONLY IF PAID
    if (isPaid && custPhone && custPhone !== '0000000000') {
      await connection.query(
        `INSERT INTO customers (name, phone, total_spent, total_orders, created_at)
         VALUES (?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE 
           name = VALUES(name),
           total_spent = total_spent + VALUES(total_spent),
           total_orders = total_orders + 1`,
        [custName, custPhone, totalAmt]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: isPaid ? 'Sale finalized and stock deducted successfully' : `Order recorded with status: ${resolvedPaymentStatus}. Stock untouched.`,
      stockDeducted,
      order: {
        id: orderId,
        order_number: orderNum,
        invoice_id: orderNum,
        orderId: orderNum,
        payment_status: resolvedPaymentStatus,
        order_status: computedOrderStatus,
        total_amount: totalAmt
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Process Order Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// @desc    Get All Orders (Invoices) - Staff/Admin gets all, Customer gets their own
// @route   GET /api/v1/orders
exports.getOrders = async (req, res) => {
  try {
    const { order_source, source } = req.query;
    const targetSource = (order_source || source || '').toUpperCase().trim();
    const userRole = (req.user?.role || 'customer').toLowerCase();
    const isStaffOrAdmin = userRole === 'admin' || userRole === 'staff';
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    const userPhone = String(req.user?.phoneNumber || req.user?.phone || '').trim();

    let querySql = `SELECT o.*, 
        c.address AS customer_address,
        c.city AS customer_city,
        c.pincode AS customer_pincode,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS itemCount
       FROM orders o
       LEFT JOIN customers c ON (o.customer_phone = c.phone OR (o.customer_id IS NOT NULL AND o.customer_id = c.id))
       WHERE 1=1`;
    const queryParams = [];

    // If customer, restrict to their own orders only
    if (!isStaffOrAdmin) {
      if (userEmail && userPhone) {
        querySql += ` AND (LOWER(o.customer_email) = ? OR o.customer_phone = ?)`;
        queryParams.push(userEmail, userPhone);
      } else if (userEmail) {
        querySql += ` AND LOWER(o.customer_email) = ?`;
        queryParams.push(userEmail);
      } else if (userPhone) {
        querySql += ` AND o.customer_phone = ?`;
        queryParams.push(userPhone);
      } else {
        return res.status(200).json({ success: true, orders: [] });
      }
    }

    if (targetSource && targetSource !== 'ALL') {
      querySql += ` AND UPPER(o.order_source) = ?`;
      queryParams.push(targetSource);
    }

    querySql += ` ORDER BY o.id DESC LIMIT 200`;

    const [orders] = await db.query(querySql, queryParams);

    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const [allItems] = await db.query(
        `SELECT oi.*, p.image_url, p.cost_price, p.category AS product_category
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );

      const itemsByOrderId = {};
      allItems.forEach(it => {
        if (!itemsByOrderId[it.order_id]) itemsByOrderId[it.order_id] = [];
        const sellingPrice = Number(it.price || 0);
        const costPrice = it.cost_price !== null && it.cost_price !== undefined ? Number(it.cost_price) : (sellingPrice * 0.7);
        const qty = Number(it.quantity || 1);
        const subtotal = Number(it.subtotal || (sellingPrice * qty));
        const itemProfit = (sellingPrice - costPrice) * qty;

        itemsByOrderId[it.order_id].push({
          id: it.id,
          productId: it.product_id,
          productName: it.product_name,
          name: it.product_name,
          price: sellingPrice,
          sellingPrice: sellingPrice,
          costPrice: costPrice,
          quantity: qty,
          subtotal: subtotal,
          profit: itemProfit,
          imageUrl: it.image_url || '',
          image: it.image_url || '',
          category: it.product_category || ''
        });
      });

      orders.forEach(o => {
        const orderItems = itemsByOrderId[o.id] || [];
        o.items = orderItems;
        o.address = o.customer_address || o.address || '';
        o.shipping_address = o.customer_address || o.shipping_address || o.address || '';
        const totalProfit = orderItems.reduce((sum, it) => sum + (it.profit || 0), 0);
        const totalCost = orderItems.reduce((sum, it) => sum + ((it.costPrice || 0) * (it.quantity || 1)), 0);
        o.profit = totalProfit > 0 ? totalProfit : (Number(o.total_amount || 0) * 0.3);
        o.gross_profit = o.profit;
        o.total_cost = totalCost;
      });
    }

    res.status(200).json({
      success: true,
      orders
    });
  } catch (error) {
    console.error('Get Orders Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Order by ID or Invoice ID
// @route   GET /api/v1/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const [orders] = await db.query(
      `SELECT o.*, 
              c.address AS customer_address,
              c.city AS customer_city,
              c.pincode AS customer_pincode
       FROM orders o
       LEFT JOIN customers c ON (o.customer_phone = c.phone OR (o.customer_id IS NOT NULL AND o.customer_id = c.id))
       WHERE o.id = ? OR o.order_number = ? LIMIT 1`,
      [id, id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orders[0];
    order.address = order.customer_address || order.address || '';
    order.shipping_address = order.customer_address || order.shipping_address || order.address || '';
    const [items] = await db.query(
      `SELECT oi.*, p.image_url, p.cost_price, p.category AS product_category
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [order.id]
    );

    const mappedItems = items.map(it => {
      const sellingPrice = Number(it.price || 0);
      const costPrice = it.cost_price !== null && it.cost_price !== undefined ? Number(it.cost_price) : (sellingPrice * 0.7);
      const qty = Number(it.quantity || 1);
      const subtotal = Number(it.subtotal || (sellingPrice * qty));
      const itemProfit = (sellingPrice - costPrice) * qty;

      return {
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        name: it.product_name,
        price: sellingPrice,
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        quantity: qty,
        subtotal: subtotal,
        profit: itemProfit,
        imageUrl: it.image_url || '',
        image: it.image_url || '',
        category: it.product_category || ''
      };
    });

    const totalProfit = mappedItems.reduce((sum, it) => sum + (it.profit || 0), 0);
    const totalCost = mappedItems.reduce((sum, it) => sum + ((it.costPrice || 0) * (it.quantity || 1)), 0);

    res.status(200).json({
      success: true,
      order: {
        ...order,
        items: mappedItems,
        profit: totalProfit > 0 ? totalProfit : (Number(order.total_amount || 0) * 0.3),
        gross_profit: totalProfit > 0 ? totalProfit : (Number(order.total_amount || 0) * 0.3),
        total_cost: totalCost
      }
    });
  } catch (error) {
    console.error('Get Order By ID Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update Order Status or Payment Status
// @route   PUT /api/v1/orders/:id
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { order_status, orderStatus, payment_status, paymentStatus } = req.body;

    const newOrderStatus = (order_status || orderStatus || '').toUpperCase().trim();
    const newPaymentStatus = (payment_status || paymentStatus || '').toUpperCase().trim();

    const VALID_ORDER_STATUSES = [
      'PENDING', 
      'CONFIRMED', 
      'IN_PACKING_QUEUE', 
      'PACKED', 
      'READY_TO_SHIP', 
      'SHIPPED', 
      'OUT_FOR_DELIVERY', 
      'DELIVERED', 
      'CANCELLED'
    ];
    const VALID_PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

    if (newOrderStatus && !VALID_ORDER_STATUSES.includes(newOrderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order_status "${newOrderStatus}". Allowed values: ${VALID_ORDER_STATUSES.join(', ')}`
      });
    }

    if (newPaymentStatus && !VALID_PAYMENT_STATUSES.includes(newPaymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment_status "${newPaymentStatus}". Allowed values: ${VALID_PAYMENT_STATUSES.join(', ')}`
      });
    }

    const [existing] = await db.query(
      `SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1`,
      [id, id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderId = existing[0].id;
    const updates = [];
    const params = [];

    if (newOrderStatus) {
      updates.push('order_status = ?');
      params.push(newOrderStatus);
    }
    if (newPaymentStatus) {
      updates.push('payment_status = ?');
      params.push(newPaymentStatus);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid status field provided for update' });
    }

    updates.push('updated_at = NOW()');
    params.push(orderId);

    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      orderId,
      order_status: newOrderStatus || existing[0].order_status,
      payment_status: newPaymentStatus || existing[0].payment_status
    });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete Order / Invoice & Automatically Restore Stock
// @route   DELETE /api/v1/orders/:id
exports.deleteOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [existing] = await connection.query(
      `SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1 FOR UPDATE`,
      [id, id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const targetOrder = existing[0];
    const isPaid = targetOrder.payment_status === 'PAID';

    // Fetch order items to restore product stock
    const [orderItems] = await connection.query(
      `SELECT * FROM order_items WHERE order_id = ?`,
      [targetOrder.id]
    );

    let stockRestoredCount = 0;
    if (isPaid && orderItems.length > 0) {
      for (const item of orderItems) {
        const qty = Number(item.quantity || 1);
        const prodId = item.product_id;
        if (prodId) {
          await connection.query(
            `UPDATE products SET stock = stock + ? WHERE id = ? OR barcode = ? OR qr_code = ?`,
            [qty, prodId, prodId, prodId]
          );
          stockRestoredCount += qty;
        }
      }
    }

    // Revert customer spent & order count if paid
    if (isPaid && targetOrder.customer_phone && targetOrder.customer_phone !== '0000000000') {
      const orderTotal = Number(targetOrder.total_amount || 0);
      await connection.query(
        `UPDATE customers 
         SET total_spent = GREATEST(0, total_spent - ?),
             total_orders = GREATEST(0, total_orders - 1)
         WHERE phone = ?`,
        [orderTotal, targetOrder.customer_phone]
      );
    }

    // Safely delete associated order_items first, then delete the order header
    await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [targetOrder.id]);
    await connection.query(`DELETE FROM orders WHERE id = ?`, [targetOrder.id]);

    // Scenario C: If deleting the latest MDF-XXX order, roll back sequence so number is reusable
    if (targetOrder.order_number && targetOrder.order_number.startsWith('MDF-')) {
      const [remainingOrders] = await connection.query(
        `SELECT order_number FROM orders WHERE order_number LIKE 'MDF-%' ORDER BY id DESC LIMIT 1`
      );
      let maxRemainingSeq = 0;
      if (remainingOrders.length > 0) {
        const lastOrderNum = remainingOrders[0].order_number;
        const numPart = parseInt(lastOrderNum.replace('MDF-', ''), 10);
        if (!isNaN(numPart)) {
          maxRemainingSeq = numPart;
        }
      }
      await connection.query(
        `UPDATE settings SET setting_value = ? WHERE setting_key = 'invoice_sequence'`,
        [String(maxRemainingSeq)]
      );
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `Invoice "${targetOrder.order_number}" deleted permanently. ${stockRestoredCount > 0 ? `${stockRestoredCount} item(s) restored to stock.` : ''}`,
      stockRestored: stockRestoredCount
    });

  } catch (error) {
    await connection.rollback();
    console.error('Delete Order Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};
