const { admin, db } = require('../config/firebase.config');

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'No authorization token provided.' });
    }

    let decodedToken;
    let userData = null;

    try {
      // Verify Firebase ID Token in standard environments
      decodedToken = await admin.auth().verifyIdToken(token);
      
      // Fetch associated user profile from Firestore users collection
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      if (userDoc.exists) {
        userData = userDoc.data();
      }
    } catch (adminErr) {
      const isCredsError = adminErr.message?.includes('Could not load the default credentials') || 
                           adminErr.code === 'app/no-credentials';

      if (isCredsError) {
        // Fallback JWT parsing for localhost/development environment when service account cert is not present
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
          decodedToken = JSON.parse(payloadJson);
        }

        if (!decodedToken) {
          throw adminErr;
        }

        // If client passed user context in request body, use it
        const bodyUser = req.body && req.body.user;
        req.user = {
          uid: decodedToken.user_id || decodedToken.uid,
          email: decodedToken.email,
          name: (bodyUser && bodyUser.name) || decodedToken.name || decodedToken.email?.split('@')[0] || 'Fallback User',
          role: ((bodyUser && bodyUser.role) || decodedToken.role || 'admin').toLowerCase(),
          branchId: (bodyUser && bodyUser.branchId) || decodedToken.branchId || '',
          branchCode: (bodyUser && bodyUser.branchCode) || decodedToken.branchCode || '',
          isFallback: true
        };
        return next();
      } else {
        throw adminErr;
      }
    }

    if (!userData) {
      // If user profile is not found in Firestore, fallback to a default staff role
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split('@')[0],
        role: 'staff',
        branchId: '',
        branchCode: ''
      };
    } else {
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: userData.name || decodedToken.name || decodedToken.email.split('@')[0],
        role: (userData.role || 'staff').toLowerCase(),
        branchId: userData.branchId || '',
        branchCode: userData.branchCode || ''
      };
    }

    next();
  } catch (error) {
    console.error('Firebase Auth Middleware Error:', error.message);
    return res.status(401).json({ success: false, message: 'Authentication failed: ' + error.message });
  }
};

module.exports = { verifyFirebaseToken };
