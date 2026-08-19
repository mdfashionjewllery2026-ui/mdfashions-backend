const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'https://mdfashions.in',
  'https://www.mdfashions.in',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://10.43.52.75:3000',
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Razorpay webhooks, mobile apps, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature'],
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mock Routes
app.get('/', (req, res) => {
  res.send('Jewellery Billing API is running...');
});

// Import Routes
const paymentRoutes = require('./routes/payment.routes');
const reportRoutes = require('./routes/report.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const printerRoutes = require('./routes/printer.routes');
const excelRoutes = require('./routes/excel.routes');
const imageRoutes = require('./routes/image.routes');

const { startOrderEngine } = require('./automation/orderEngine');

app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/printer', printerRoutes);
app.use('/api/v1/excel', excelRoutes);
app.use('/api/v1/images', imageRoutes);

// Global error handling middleware (handles URIError / malformed URLs)
app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    console.warn(`[URIError] Bad request received at ${req.path}:`, err.message);
    return res.status(400).json({ success: false, message: 'Malformed URL request: ' + err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Start the automated order processor
  startOrderEngine();
});
