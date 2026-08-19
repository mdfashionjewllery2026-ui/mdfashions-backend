const { db, admin } = require('../config/firebase.config');

const startOrderEngine = () => {
  console.log('🚀 Starting Enterprise Order Automation Engine...');
  console.log('📦 Module isolation: WEB orders only → Packing Queue');
  console.log('🏬 POS showroom orders are excluded from warehouse automation');

  const ordersRef = db.collection('orders');

  // ✅ ENTERPRISE ISOLATION & PAYMENT SAFETY:
  // Process ONLY WEB orders that are fully PAID. Unpaid/PENDING/FAILED orders
  // must NEVER enter the warehouse packing queue or consume inventory.
  const query = ordersRef
    .where('automationStatus', '==', 'PENDING')
    .where('orderSource', '==', 'WEB')
    .where('paymentStatus', '==', 'PAID');

  query.onSnapshot(async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added' || change.type === 'modified') {
        const orderData = change.doc.data();
        const orderId = change.doc.id;

        // Double-check guard 1: Never process POS showroom orders
        if (orderData.orderSource === 'POS' || orderData.source === 'POS') {
          console.warn(`⚠️ [AUTOMATION ENGINE] Skipping POS order ${orderId} — showroom orders bypass warehouse queue.`);
          return;
        }

        // Double-check guard 2: Strictly require paymentStatus === 'PAID'
        if (orderData.paymentStatus !== 'PAID') {
          console.warn(`⚠️ [AUTOMATION ENGINE] Skipping unpaid order ${orderId} — paymentStatus is ${orderData.paymentStatus}.`);
          return;
        }

        console.log(`⚡ [AUTOMATION ENGINE] Processing Verified Paid WEB Order: ${orderId}`);

        try {
          await processOrder(orderId, orderData);
        } catch (error) {
          console.error(`❌ [AUTOMATION ENGINE] Error processing order ${orderId}:`, error);
          await db.collection('orders').doc(orderId).update({
            automationStatus: 'FAILED',
            automationError: error.message
          });
        }
      }
    });
  }, (error) => {
    console.error('❌ [AUTOMATION ENGINE] Firestore listener error:', error);
  });
};


const processOrder = async (orderId, orderData) => {
  // Extract items
  const items = orderData.items || [];
  
  // 1. Transaction to update order status, timeline, notifications and dispatch
  await db.runTransaction(async (t) => {
    let paymentStatus = orderData.paymentStatus || 'PENDING';
    if (orderData.paymentMethod === 'ONLINE' && orderData.paymentStatus === 'PAID') {
        paymentStatus = 'PAID';
    } else if (orderData.paymentMethod === 'COD') {
        paymentStatus = 'PENDING';
    }

    // 2. Update Order Status to IN_PACKING_QUEUE
    const orderRef = db.collection('orders').doc(orderId);

    const newTimelineEntry = {
      status: 'IN_PACKING_QUEUE',
      timestamp: new Date().toISOString(),
      description: 'Order validated and sent to warehouse packing queue.'
    };

    t.update(orderRef, {
      automationStatus: 'PROCESSED',
      orderStatus: 'IN_PACKING_QUEUE',
      paymentStatus: paymentStatus,
      timeline: admin.firestore.FieldValue.arrayUnion(newTimelineEntry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Dispatch to Packing Queue
    const packingRef = db.collection('packing_queue').doc(orderId);
    t.set(packingRef, {
      orderId: orderData.orderId || orderId,
      customerName: orderData.customerName || 'Customer',
      itemsCount: items.length,
      status: 'IN_PACKING_QUEUE',
      queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      priority: orderData.priority || 'NORMAL'
    });

    // 4. Dispatch Customer Notification
    if (orderData.customerEmail || orderData.customerPhone) {
      const notifRef = db.collection('notifications').doc();
      t.set(notifRef, {
        customerEmail: orderData.customerEmail || '',
        customerPhone: orderData.customerPhone || '',
        orderId: orderData.orderId || orderId,
        status: 'CONFIRMED',
        message: `Your order ${orderData.orderId || orderId} has been confirmed and is being packed!`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });
    }
  });

  console.log(`✅ [AUTOMATION ENGINE] Order ${orderId} confirmed and dispatched to Packing Queue.`);
};

module.exports = { startOrderEngine };
