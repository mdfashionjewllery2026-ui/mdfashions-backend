const razorpay = require('../config/razorpay.config');
const crypto = require('crypto');
const { db, admin } = require('../config/firebase.config');
const { recalculateSummaryDocs } = require('../services/summaryService');

const isComponentSelectedInCombo = (compRole, selectedOption, comboComponents) => {
  if (!selectedOption) return true;
  const optLower = selectedOption.toLowerCase();
  if (optLower.startsWith('full combo')) return true;

  const comp = comboComponents?.find(c => c.role === compRole);
  if (!comp) return false;

  const catName = (comp.category || '').toLowerCase();
  const roleDefaultName = compRole === 'necklace' ? 'necklace' : compRole === 'earrings' ? 'earrings' : 'other';

  return optLower.includes(catName) || optLower.includes(roleDefaultName);
};

// Centralized Atomic Order Fulfillment Helper (used by verifyPayment, getPaymentStatus, and handleWebhook)
exports.fulfillOrderPayment = async (orderId, razorpay_payment_id, razorpay_order_id) => {
  console.log('[PaymentDebug] fulfillOrderPayment called:', { orderId, razorpay_payment_id, razorpay_order_id });
  
  let orderRef = db.collection('orders').doc(orderId);
  let orderDoc = await orderRef.get();

  if (!orderDoc.exists) {
    let qSnap = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
    if (qSnap.empty && razorpay_order_id) {
      qSnap = await db.collection('orders').where('razorpayOrderId', '==', razorpay_order_id).limit(1).get();
    }
    if (!qSnap.empty) {
      orderDoc = qSnap.docs[0];
      orderRef = orderDoc.ref;
    }
  }

  if (!orderDoc.exists) {
    throw new Error(`Order ${orderId} not found in Firestore`);
  }

  const orderData = orderDoc.data();
  const actualOrderId = orderDoc.id;

  // Idempotency: If order is already PAID, return success immediately
  if (orderData.paymentStatus === 'PAID') {
    console.log(`[PaymentDebug] Firestore updated? Order ${actualOrderId} is ALREADY PAID.`);
    return { success: true, message: "Order is already paid", orderId: actualOrderId };
  }

  const items = orderData.items || [];
  const categoryNamesToQuery = new Set();

  const getBaseProductId = (item) => {
    return item.dbProductId || item.originalId || (item.productId && typeof item.productId === 'string' ? item.productId.split('_')[0] : item.productId) || (item.id && typeof item.id === 'string' ? item.id.split('_')[0] : item.id);
  };

  for (const item of items) {
    if (item.category) categoryNamesToQuery.add(item.category);
    const prodId = getBaseProductId(item);
    if (prodId) {
      const pDoc = await db.collection('products').doc(prodId).get();
      if (pDoc.exists) {
        const pData = pDoc.data();
        if (pData.comboComponents && Array.isArray(pData.comboComponents)) {
          for (const comp of pData.comboComponents) {
            if (comp.productId && isComponentSelectedInCombo(comp.role, item.selectedComboOption, pData.comboComponents)) {
              const compDoc = await db.collection('products').doc(comp.productId).get();
              if (compDoc.exists && compDoc.data().category) {
                categoryNamesToQuery.add(compDoc.data().category);
              }
            }
          }
        }
      }
    }
  }

  const categoryRefs = {};
  for (const catName of categoryNamesToQuery) {
    const catSnap = await db.collection('categories').where('categoryName', '==', catName).limit(1).get();
    if (!catSnap.empty) {
      categoryRefs[catName] = catSnap.docs[0].ref;
    }
  }

  const date = new Date().toISOString().split('T')[0];
  const reportRef = db.collection('daily_reports').doc(date);
  const newTxnRef = db.collection('transactions').doc(razorpay_payment_id || `txn_${Date.now()}`);
  const oldTxnRef = razorpay_order_id ? db.collection('transactions').doc(razorpay_order_id) : null;

  await db.runTransaction(async (t) => {
    // ==========================================
    // PHASE 1: ALL READS (Must happen first)
    // ==========================================
    const tOrderDoc = await t.get(orderRef);
    if (!tOrderDoc.exists) throw new Error("Order not found during transaction");
    const tOrderData = tOrderDoc.data();

    if (tOrderData.paymentStatus === 'PAID') {
      return; // Already processed concurrently
    }

    const rDoc = await t.get(reportRef);

    // Aggregate quantities by base product ID
    const mainQtyMap = {};
    const mainItemsMap = {};

    for (const item of items) {
      const prodId = getBaseProductId(item);
      if (!prodId) continue;
      const qty = item.quantity || 1;
      mainQtyMap[prodId] = (mainQtyMap[prodId] || 0) + qty;
      if (!mainItemsMap[prodId]) mainItemsMap[prodId] = [];
      mainItemsMap[prodId].push({ item, qty });
    }

    // Read all main products (Dual-ID Resolver: matches doc key OR custom productId field)
    const mainProductRefs = {};
    const mainProductSnaps = {};
    for (const prodId of Object.keys(mainQtyMap)) {
      let pRef = db.collection('products').doc(prodId);
      let pSnap = await t.get(pRef);

      if (!pSnap.exists) {
        // Dual-ID Fallback: Search by custom productId field if doc key lookup returned false
        const qSnap = await db.collection('products').where('productId', '==', prodId).limit(1).get();
        if (!qSnap.empty) {
          const matchedDoc = qSnap.docs[0];
          pRef = db.collection('products').doc(matchedDoc.id);
          pSnap = await t.get(pRef);
        }
      }

      mainProductRefs[prodId] = pRef;
      mainProductSnaps[prodId] = pSnap;
    }

    // Compute combo requirements based on main product data
    const compQtyMap = {};
    for (const prodId of Object.keys(mainQtyMap)) {
      const snap = mainProductSnaps[prodId];
      if (!snap || !snap.exists) continue;
      const pData = snap.data();
      if (pData.comboComponents && Array.isArray(pData.comboComponents)) {
        const itemsForProduct = mainItemsMap[prodId];
        for (const { item, qty } of itemsForProduct) {
          for (const comp of pData.comboComponents) {
            if (comp.productId && isComponentSelectedInCombo(comp.role, item.selectedComboOption, pData.comboComponents)) {
              const compQty = Number(comp.qty || 1) * qty;
              if (!compQtyMap[comp.productId]) {
                compQtyMap[comp.productId] = {
                  qty: 0,
                  componentName: comp.productName || 'Component',
                  comboName: pData.productName || pData.name
                };
              }
              compQtyMap[comp.productId].qty += compQty;
            }
          }
        }
      }
    }

    // Read all combo products (Dual-ID Resolver)
    const compProductRefs = {};
    const compProductSnaps = {};
    for (const compId of Object.keys(compQtyMap)) {
      let compRef = db.collection('products').doc(compId);
      let compSnap = await t.get(compRef);

      if (!compSnap.exists) {
        const qSnap = await db.collection('products').where('productId', '==', compId).limit(1).get();
        if (!qSnap.empty) {
          const matchedDoc = qSnap.docs[0];
          compRef = db.collection('products').doc(matchedDoc.id);
          compSnap = await t.get(compRef);
        }
      }

      compProductRefs[compId] = compRef;
      compProductSnaps[compId] = compSnap;
    }

    // ==========================================
    // PHASE 2: ALL WRITES (Must happen after all reads)
    // ==========================================
    
    // 1. Update Order Document
    t.update(orderRef, {
      paymentId: razorpay_payment_id || null,
      razorpayPaymentId: razorpay_payment_id || null,
      razorpayOrderId: razorpay_order_id || tOrderData.razorpayOrderId || null,
      paymentStatus: 'PAID',
      orderStatus: 'CONFIRMED',
      automationStatus: 'PENDING',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      timeline: admin.firestore.FieldValue.arrayUnion({
        status: "CONFIRMED",
        timestamp: new Date().toISOString(),
        description: "Payment verified successfully via Razorpay."
      })
    });

    // 2. Deduct stock for main products & write movement logs
    for (const prodId of Object.keys(mainQtyMap)) {
      const ref = mainProductRefs[prodId];
      const snap = mainProductSnaps[prodId];
      if (!snap.exists) continue;
      const pData = snap.data();
      const currentStock = pData.availableStock !== undefined ? Number(pData.availableStock) : Number(pData.stock || 0);
      const totalQtyNeeded = mainQtyMap[prodId];
      const newStock = Math.max(0, currentStock - totalQtyNeeded);
      const newStatus = newStock <= 0 ? 'OUT_OF_STOCK' : 'AVAILABLE';

      t.update(ref, {
        stock: newStock,
        availableStock: newStock,
        inStock: newStock > 0,
        status: newStatus,
        salesCount: admin.firestore.FieldValue.increment(totalQtyNeeded),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const itemsForProduct = mainItemsMap[prodId];
      for (const { item, qty } of itemsForProduct) {
        const invLogRef = db.collection('inventory_transactions').doc();
        t.set(invLogRef, {
          productId: item.productId || item.id,
          type: 'SALE',
          quantity: -qty,
          cartQuantity: -qty,
          balanceAfter: newStock,
          invoiceId: actualOrderId,
          date: admin.firestore.FieldValue.serverTimestamp(),
          performedBy: 'RAZORPAY_GATEWAY',
          reason: `Sale to ${tOrderData.customerName || 'Customer'}`
        });

        const movementRef = db.collection('stock_movements').doc();
        t.set(movementRef, {
          productId: item.productId || '',
          productDocId: ref.id,
          productName: item.productName || item.name || '',
          date: admin.firestore.FieldValue.serverTimestamp(),
          user: 'RAZORPAY_GATEWAY',
          action: 'SALE',
          quantity: -qty,
          remarks: `Web Sale (Order: ${actualOrderId})`
        });
      }

      const catName = pData.category;
      if (catName && categoryRefs[catName]) {
        t.update(categoryRefs[catName], {
          totalStock: admin.firestore.FieldValue.increment(-totalQtyNeeded),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // 3. Deduct stock for combo components & write logs
    for (const compId of Object.keys(compQtyMap)) {
      const ref = compProductRefs[compId];
      const snap = compProductSnaps[compId];
      if (!snap.exists) continue;
      const compData = snap.data();
      const compInfo = compQtyMap[compId];
      const currentCompStock = compData.availableStock !== undefined ? Number(compData.availableStock) : Number(compData.stock || 0);
      const newCompStock = Math.max(0, currentCompStock - compInfo.qty);
      const newCompStatus = newCompStock <= 0 ? 'OUT_OF_STOCK' : 'AVAILABLE';

      t.update(ref, {
        stock: newCompStock,
        availableStock: newCompStock,
        inStock: newCompStock > 0,
        status: newCompStatus,
        salesCount: admin.firestore.FieldValue.increment(compInfo.qty),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const compLogRef = db.collection('inventory_transactions').doc();
      t.set(compLogRef, {
        productId: compId,
        type: 'SALE',
        quantity: -compInfo.qty,
        cartQuantity: -compInfo.qty,
        balanceAfter: newCompStock,
        invoiceId: actualOrderId,
        date: admin.firestore.FieldValue.serverTimestamp(),
        performedBy: 'RAZORPAY_GATEWAY',
        reason: `Sale of Combo component: ${compInfo.componentName || compData.productName}`
      });

      const movementCompRef = db.collection('stock_movements').doc();
      t.set(movementCompRef, {
        productId: compData.productId || '',
        productDocId: compId,
        productName: compInfo.componentName || compData.productName || '',
        date: admin.firestore.FieldValue.serverTimestamp(),
        user: 'RAZORPAY_GATEWAY',
        action: 'SALE',
        quantity: -compInfo.qty,
        remarks: `Sale of Combo component (Order: ${actualOrderId})`
      });

      const compCatName = compData.category;
      if (compCatName && categoryRefs[compCatName]) {
        t.update(categoryRefs[compCatName], {
          totalStock: admin.firestore.FieldValue.increment(-compInfo.qty),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // 4. Add Order to Warehouse Packing Queue
    const packingRef = db.collection('packing_queue').doc(actualOrderId);
    t.set(packingRef, {
      orderId: actualOrderId,
      customerName: tOrderData.customerName || 'Customer',
      itemsCount: items.length,
      priority: "NORMAL",
      status: "IN_PACKING_QUEUE",
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 5. Create Profit Entry
    let totalProfit = 0;
    const profitItems = items.map(item => {
      const itemPrice = Number(item.sellingPrice || item.price || 0);
      const itemQty = Number(item.quantity || 1);
      const purchasePrice = Number(item.purchasePrice || item.oldPrice || 0);
      const finalSubtotal = itemPrice * itemQty;
      const itemProfit = finalSubtotal - (purchasePrice * itemQty);
      totalProfit += itemProfit;
      return {
        productId: item.productId || item.id,
        productName: item.name || item.productName || '',
        quantity: itemQty,
        purchasePrice,
        sellingPrice: itemPrice,
        finalSubtotal,
        profit: itemProfit
      };
    });

    const profitRef = db.collection('profits').doc(actualOrderId);
    t.set(profitRef, {
      profitId: actualOrderId,
      invoiceId: actualOrderId,
      customerId: tOrderData.customerId || 'temp_id',
      customerName: tOrderData.customerName || 'Customer',
      totalAmount: tOrderData.totalAmount || 0,
      profit: totalProfit,
      branchId: "online_store",
      branchName: "Online Store",
      branchCode: "WEB-01",
      items: profitItems,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 6. Update Customer profile metrics
    if (tOrderData.customerId) {
      const customerRef = db.collection('customers').doc(tOrderData.customerId);
      t.set(customerRef, {
        totalSpent: admin.firestore.FieldValue.increment(tOrderData.totalAmount || 0),
        totalOrders: admin.firestore.FieldValue.increment(1),
        lastPurchaseDate: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // 7. Transaction Record
    t.set(newTxnRef, {
      txn_id: razorpay_payment_id || actualOrderId,
      bill_id: actualOrderId,
      razorpay_order_id: razorpay_order_id || null,
      razorpay_payment_id: razorpay_payment_id || null,
      amount: tOrderData.totalAmount || 0,
      method: tOrderData.paymentMethod || 'CARD',
      status: 'PAID',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 8. Bump Catalog Version Doc (meta/versions)
    const versionRef = db.collection('meta').doc('versions');
    t.set(versionRef, {
      products: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (oldTxnRef) {
      t.delete(oldTxnRef); // FIX BUG 3: removed .catch()
    }

    // 8. Daily Reports Update
    if (!rDoc.exists) {
      t.set(reportRef, {
        totalSales: tOrderData.totalAmount || 0,
        upiTotal: tOrderData.paymentMethod === 'UPI' ? (tOrderData.totalAmount || 0) : 0,
        cardTotal: tOrderData.paymentMethod === 'CARD' ? (tOrderData.totalAmount || 0) : 0,
        orderCount: 1
      });
    } else {
      const rData = rDoc.data();
      t.update(reportRef, {
        totalSales: (rData.totalSales || 0) + (tOrderData.totalAmount || 0),
        upiTotal: (rData.upiTotal || 0) + (tOrderData.paymentMethod === 'UPI' ? (tOrderData.totalAmount || 0) : 0),
        cardTotal: (rData.cardTotal || 0) + (tOrderData.paymentMethod === 'CARD' ? (tOrderData.totalAmount || 0) : 0),
        orderCount: (rData.orderCount || 0) + 1
      });
    }
  });

  console.log(`[PaymentDebug] Firestore updated? Order ${actualOrderId} successfully updated to PAID & CONFIRMED.`);

  recalculateSummaryDocs().catch(err => console.error("Error updating summaries post-payment:", err));

  return { success: true, message: "Payment fulfilled successfully", orderId: actualOrderId };
};

// @desc    Create Razorpay Order
// @route   POST /api/v1/payments/create-order
exports.createOrder = async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes, billData } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    const localOrderId = billData?.orderId || notes?.order_id || `MLR-${Date.now().toString().slice(-6)}`;

    const options = {
      amount: Math.round(amount * 100), // Razorpay expects amount in paise
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
        amount: Math.round(amount * 100),
        currency: currency
      };
    }

    // Map items to match unified schema
    const mappedItems = (billData?.items || []).map(item => ({
      id: item.id || item.productId || "",
      productId: item.productId || item.id || "",
      name: item.productName || item.name || "",
      productName: item.productName || item.name || "",
      price: Number(item.sellingPrice || item.price || 0) || 0,
      sellingPrice: Number(item.sellingPrice || item.price || 0) || 0,
      quantity: Number(item.quantity || 1) || 1,
      metal: item.metal || item.purity || "Premium Quality",
      weight: item.weight || item.netWeight || "10g",
      category: item.category || "",
      selectedAttachment: item.selectedAttachment || null,
      selectedComboOption: item.selectedComboOption || null
    }));

    const orderRef = db.collection('orders').doc(localOrderId);
    const txnRef = db.collection('transactions').doc(order.id);

    const batch = db.batch();

    // Pre-save order state: paymentStatus = CREATED / PENDING, orderStatus = PENDING
    batch.set(orderRef, {
      orderId: localOrderId,
      invoiceId: localOrderId,
      customerId: billData?.customerId || 'temp_id',
      customerName: billData?.customerName || 'Customer',
      customerPhone: billData?.customerPhone || billData?.customerMobile || 'N/A',
      customerMobile: billData?.customerPhone || billData?.customerMobile || 'N/A',
      customerEmail: billData?.customerEmail || 'N/A',
      items: mappedItems,
      totalAmount: billData?.totalAmount || amount,
      grandTotal: billData?.totalAmount || amount,
      subtotal: billData?.subtotal || amount,
      shipping: billData?.shipping || 0,
      gst: billData?.gst || 0,
      address: billData?.address || null,
      paymentMethod: billData?.paymentMethod || 'CARD',
      paymentProvider: billData?.paymentProvider || 'Razorpay',
      paymentStatus: 'PENDING',
      orderStatus: 'PENDING',
      razorpayOrderId: order.id,
      automationStatus: 'PENDING',
      source: billData?.source || 'WEB',
      branchId: 'online_store',
      branchName: 'Online Store',
      branchCode: 'WEB-01',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timeline: [
        {
          status: 'PENDING',
          timestamp: new Date().toISOString(),
          description: 'Order created on website, waiting for Razorpay payment.'
        }
      ]
    }, { merge: true });

    batch.set(txnRef, {
      txn_id: order.id,
      bill_id: localOrderId,
      razorpay_order_id: order.id,
      amount: billData?.totalAmount || amount,
      method: billData?.paymentMethod || 'CARD',
      status: 'PENDING',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();

    console.log('[PaymentDebug] Razorpay opened / Order created on backend:', { localOrderId, razorpayOrderId: order.id, amount: order.amount });

    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      billId: localOrderId,
      isMock
    });
  } catch (error) {
    console.error('Razorpay Order Error:', error);
    res.status(500).json({ success: false, message: error.message });
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

    console.log('[PaymentDebug] Backend verified? Signature valid!');

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

    console.log('[PaymentDebug] getPaymentStatus query for orderId:', orderId);

    // 1. Check Firestore orders collection first
    let orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      const snap = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
      if (!snap.empty) {
        orderDoc = snap.docs[0];
      }
    }

    if (!orderDoc.exists) {
      const snapRzp = await db.collection('orders').where('razorpayOrderId', '==', orderId).limit(1).get();
      if (!snapRzp.empty) {
        orderDoc = snapRzp.docs[0];
      }
    }

    if (orderDoc && orderDoc.exists) {
      const oData = orderDoc.data();
      if (oData.paymentStatus === 'PAID') {
        return res.status(200).json({
          success: true,
          status: 'captured',
          paymentStatus: 'PAID',
          orderId: orderDoc.id,
          razorpayPaymentId: oData.razorpayPaymentId || oData.paymentId
        });
      } else if (oData.paymentStatus === 'FAILED') {
        return res.status(200).json({
          success: true,
          status: 'failed',
          paymentStatus: 'FAILED',
          orderId: orderDoc.id
        });
      }
    }

    // 2. Query Razorpay API directly using Razorpay Order ID if available
    let isMock = process.env.RAZORPAY_KEY_ID === 'rzp_test_YOUR_TEST_KEY_HERE' || !process.env.RAZORPAY_KEY_ID;
    const razorpayOrderId = (orderDoc && orderDoc.exists && orderDoc.data().razorpayOrderId) || (orderId.startsWith('order_') ? orderId : null);

    if (!isMock && razorpayOrderId) {
      try {
        const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
        if (payments && payments.items && payments.items.length > 0) {
          const capturedPayment = payments.items.find(p => p.status === 'captured');
          if (capturedPayment) {
            console.log('[PaymentDebug] Found captured payment on Razorpay API!', capturedPayment.id);
            const actualId = orderDoc ? orderDoc.id : orderId;
            await exports.fulfillOrderPayment(actualId, capturedPayment.id, razorpayOrderId);
            return res.status(200).json({
              success: true,
              status: 'captured',
              paymentStatus: 'PAID',
              paymentId: capturedPayment.id,
              orderId: actualId
            });
          }
          const failedPayment = payments.items.find(p => p.status === 'failed');
          if (failedPayment) {
            if (orderDoc && orderDoc.exists) {
              await orderDoc.ref.update({ paymentStatus: 'FAILED', orderStatus: 'FAILED' });
            }
            return res.status(200).json({
              success: true,
              status: 'failed',
              paymentStatus: 'FAILED',
              orderId: orderDoc ? orderDoc.id : orderId
            });
          }
        }
      } catch (rzpErr) {
        console.warn('[PaymentDebug] Razorpay API status fetch notice:', rzpErr.message);
      }
    }

    // Default response: Payment is still pending/created
    return res.status(200).json({
      success: true,
      status: 'created',
      paymentStatus: 'PENDING',
      orderId: orderDoc ? orderDoc.id : orderId
    });
  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

