const { db } = require('../config/firebase.config');

// @desc    Get Daily Sales Analytics
// @route   GET /api/v1/reports/daily
exports.getDailyAnalytics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const doc = await db.collection('daily_reports').doc(today).get();

    if (!doc.exists) {
      return res.status(200).json({
        success: true,
        data: {
          totalSales: 0,
          upiTotal: 0,
          cardTotal: 0,
          orderCount: 0
        }
      });
    }

    res.status(200).json({
      success: true,
      data: doc.data()
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

// @desc    Get Sales History (Last 7 Days)
// @route   GET /api/v1/reports/history
exports.getSalesHistory = async (req, res) => {
  try {
    const snapshot = await db.collection('daily_reports')
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(7)
      .get();

    const history = snapshot.docs.map(doc => ({
      date: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      success: true,
      data: history.reverse()
    });
  } catch (error) {
    console.error('History Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
};
