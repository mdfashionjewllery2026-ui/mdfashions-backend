const db = require('../config/db');

// @desc    Get Daily Sales Analytics
// @route   GET /api/v1/reports/daily
exports.getDailyAnalytics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await db.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) AS totalSales,
        COALESCE(SUM(CASE WHEN payment_method = 'UPI' THEN total_amount ELSE 0 END), 0) AS upiTotal,
        COALESCE(SUM(CASE WHEN payment_method = 'CARD' THEN total_amount ELSE 0 END), 0) AS cardTotal,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) AS cashTotal,
        COUNT(id) AS orderCount
       FROM orders
       WHERE DATE(created_at) = ? AND payment_status = 'PAID'`,
      [today]
    );

    res.status(200).json({
      success: true,
      data: rows[0] || { totalSales: 0, upiTotal: 0, cardTotal: 0, cashTotal: 0, orderCount: 0 }
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
    const [rows] = await db.query(
      `SELECT 
        DATE(created_at) AS date,
        COALESCE(SUM(total_amount), 0) AS totalSales,
        COUNT(id) AS orderCount
       FROM orders
       WHERE payment_status = 'PAID'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 7`
    );

    res.status(200).json({
      success: true,
      data: rows.reverse()
    });
  } catch (error) {
    console.error('History Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
};
