const { admin } = require('../config/firebase.config');
const db = require('../config/db');

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'No authorization token provided.' });
    }

    let decodedToken;
    let userData = null;

    if (!admin || !admin.auth || typeof admin.auth !== 'function') {
      return res.status(401).json({ success: false, message: 'Authentication service unavailable.' });
    }

    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (verifyErr) {
      // Log the specific error code for forensic diagnosis
      console.error('verifyIdToken failed — code:', verifyErr.code, '| msg:', verifyErr.message?.substring(0, 120));
      return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.', code: verifyErr.code || 'auth/verify-failed' });
    }

    if (!decodedToken || (!decodedToken.uid && !decodedToken.user_id && !decodedToken.sub)) {
      return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
    }

    const email = (decodedToken.email || '').toLowerCase().trim();

    // Fetch User Role & Profile from Hostinger MySQL Data Store if present
    if (email) {
      try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
        if (rows.length > 0) {
          userData = rows[0];
        }
      } catch (dbErr) {
        console.warn('MySQL User Lookup Warning:', dbErr.message);
      }
    }

    let determinedRole = 'customer';
    if (userData?.role) {
      // Priority 1: Authoritative MySQL users table role
      determinedRole = userData.role.toLowerCase();
    } else if (decodedToken.role) {
      // Priority 2: Custom claim 'role' set via Firebase Admin SDK
      determinedRole = String(decodedToken.role).toLowerCase();
    } else if (decodedToken.admin === true || decodedToken.isAdmin === true) {
      // Priority 3: Custom claim 'admin: true' or 'isAdmin: true'
      determinedRole = 'admin';
    }

    console.log(`[Auth] uid=${decodedToken.uid?.substring(0, 8)}... email=${email} role=${determinedRole}`);

    req.user = {
      uid: decodedToken.uid || decodedToken.user_id || decodedToken.sub,
      email: email,
      name: userData?.name || decodedToken.name || (email ? email.split('@')[0] : 'User'),
      role: determinedRole,
    };

    next();
  } catch (error) {
    console.error('Firebase Auth Middleware Error:', error.message);
    return res.status(401).json({ success: false, message: 'Authentication failed: ' + error.message });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  const role = (req.user.role || '').toLowerCase();
  if (['admin', 'owner'].includes(role)) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied: Admin authorization required.' });
};

const requireManagerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  const role = (req.user.role || '').toLowerCase();
  if (['admin', 'manager', 'owner'].includes(role)) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied: Manager or Admin authorization required.' });
};

const requireStaffOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  const role = (req.user.role || '').toLowerCase();
  if (['admin', 'manager', 'staff', 'billing', 'owner'].includes(role)) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied: Staff authorization required.' });
};

// Optional Auth Middleware: Never blocks unauthenticated requests, but attaches req.user if valid token provided
const verifyOptionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    if (!admin || !admin.auth || typeof admin.auth !== 'function') {
      return next();
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (_) {
      return next();
    }

    if (!decodedToken || (!decodedToken.uid && !decodedToken.user_id && !decodedToken.sub)) {
      return next();
    }

    const email = (decodedToken.email || '').toLowerCase().trim();
    let userData = null;
    if (email) {
      try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
        if (rows.length > 0) userData = rows[0];
      } catch (_) {}
    }

    let determinedRole = 'customer';
    if (userData?.role) {
      // Priority 1: Authoritative MySQL users table role
      determinedRole = userData.role.toLowerCase();
    } else if (decodedToken.role) {
      // Priority 2: Custom claim 'role' set via Firebase Admin SDK
      determinedRole = String(decodedToken.role).toLowerCase();
    } else if (decodedToken.admin === true || decodedToken.isAdmin === true) {
      // Priority 3: Custom claim 'admin: true' or 'isAdmin: true'
      determinedRole = 'admin';
    }

    req.user = {
      uid: decodedToken.uid || decodedToken.user_id || decodedToken.sub,
      email: email,
      name: userData?.name || decodedToken.name || (email ? email.split('@')[0] : 'User'),
      role: determinedRole,
    };
    next();
  } catch (_) {
    next();
  }
};

module.exports = {
  verifyFirebaseToken,
  verifyOptionalAuth,
  requireAdmin,
  requireManagerOrAdmin,
  requireStaffOrAdmin
};
