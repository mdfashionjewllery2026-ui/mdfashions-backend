const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'md-fashion-software',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!admin.apps.length) {
  try {
    if (firebaseConfig.clientEmail && firebaseConfig.privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig),
      });
      console.log('Firebase Admin Initialized Successfully with Cert');
    } else {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
      console.log('Firebase Admin Initialized Successfully with Project ID');
    }
  } catch (error) {
    console.error('Firebase Admin Initialization Error:', error.message);
    // Fallback initialize mock app
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'md-fashion-software' });
    }
  }
}

let db, auth;
try {
  db = admin.firestore();
  auth = admin.auth();
} catch (err) {
  console.error('Firestore init warning:', err.message);
  db = {};
  auth = {};
}

module.exports = { db, auth, admin };
