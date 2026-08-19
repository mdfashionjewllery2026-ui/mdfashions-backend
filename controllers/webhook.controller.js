const crypto = require('crypto');
const { db, admin } = require('../config/firebase.config');
const { fulfillOrderPayment } = require('./payment.controller');

// @desc    Handle Razorpay Webhooks
// @route   POST /api/v1/payments/webhook
exports.handleWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('[PaymentDebug] Webhook signature verification failed');
      return res.status(400).send('Invalid Signature');
    }

    const event = req.body.event;
    const payload = req.body.payload?.payment?.entity || req.body.payload?.order?.entity;

    console.log('[PaymentDebug] Webhook received?', { event, paymentId: payload?.id, razorpayOrderId: payload?.order_id, notes: payload?.notes });

    if (event === 'payment.captured' || event === 'order.paid') {
      const razorpay_order_id = payload.order_id || payload.id;
      const razorpay_payment_id = payload.id;
      const notes_order_id = payload.notes?.order_id || payload.notes?.orderId || payload.notes?.localOrderId;

      const targetOrderId = notes_order_id || razorpay_order_id;

      if (targetOrderId) {
        await fulfillOrderPayment(targetOrderId, razorpay_payment_id, razorpay_order_id);
        console.log('[PaymentDebug] Firestore updated? Webhook fulfilled order:', targetOrderId);
      }
    } else if (event === 'payment.failed') {
      console.log('[PaymentDebug] Webhook received? payment.failed:', payload.id);
      
      await db.collection('failed_payments').add({
        paymentId: payload.id,
        orderId: payload.order_id,
        amount: (payload.amount || 0) / 100,
        errorCode: payload.error_code,
        errorDescription: payload.error_description,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      const targetOrderId = payload.notes?.order_id || payload.notes?.orderId || payload.order_id;
      if (targetOrderId) {
        let qSnap = await db.collection('orders').where('orderId', '==', targetOrderId).limit(1).get();
        if (qSnap.empty && payload.order_id) {
          qSnap = await db.collection('orders').where('razorpayOrderId', '==', payload.order_id).limit(1).get();
        }
        if (!qSnap.empty) {
          await qSnap.docs[0].ref.update({
            paymentStatus: 'FAILED',
            orderStatus: 'FAILED',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log('[PaymentDebug] Firestore updated? Order marked FAILED:', targetOrderId);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[PaymentDebug] Webhook Processing Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

