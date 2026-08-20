const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// Initialize MySQL Pool
const dbPool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5002;

// Security Headers Middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}));

// Universal CORS configuration (Supports Custom Domains, Hostinger Preview Sites, POS, & Localhost)
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root route
app.get('/', (req, res) => {
  res.send('Jewellery Billing API is running with Hostinger MySQL...');
});

// Import Routes
const paymentRoutes = require('./routes/payment.routes');
const reportRoutes = require('./routes/report.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const orderRoutes = require('./routes/order.routes');
const customerRoutes = require('./routes/customer.routes');
const printerRoutes = require('./routes/printer.routes');
const excelRoutes = require('./routes/excel.routes');
const imageRoutes = require('./routes/image.routes');
const supplierRoutes = require('./routes/supplier.routes');
const settingRoutes = require('./routes/setting.routes');
const branchRoutes = require('./routes/branch.routes');

const { startOrderEngine } = require('./automation/orderEngine');

app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/printer', printerRoutes);
app.use('/api/v1/excel', excelRoutes);
app.use('/api/v1/images', imageRoutes);
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/branches', branchRoutes);

// Diagnostic: who am I? — returns token identity and resolved role
const { verifyFirebaseToken } = require('./middleware/firebaseAuth.middleware');
app.get('/api/v1/auth/whoami', verifyFirebaseToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('CORS policy rejection')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  if (err instanceof URIError) {
    console.warn(`[URIError] Bad request received at ${req.path}:`, err.message);
    return res.status(400).json({ success: false, message: 'Malformed URL request: ' + err.message });
  }
  console.error('[Server Error Handler]:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} connected to Hostinger MySQL`);
  startOrderEngine();
});
