const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'srv1495.hstgr.io',
  user: process.env.DB_USER || 'u941457798_mdfashions',
  password: process.env.DB_PASSWORD || 'Mdfashion@2026',
  database: process.env.DB_NAME || 'u941457798_mdfashion',
  port: parseInt(process.env.DB_PORT || '3306'),
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection on startup
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected successfully to Hostinger MySQL Database (u941457798_mdfashion)!');
    connection.release();
  } catch (err) {
    console.error('⚠️ Hostinger MySQL Connection Warning:', err.message);
    console.log('💡 Note: Ensure "Remote MySQL" with "Any Host" or your IP is enabled in Hostinger hPanel.');
  }
})();

module.exports = pool;
