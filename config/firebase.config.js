const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// ── Firebase Admin Initialization ─────────────────────────────────────────────
// Strategy: if full service account credentials are provided, use cert auth.
// Otherwise, initialize with projectId only — Firebase Admin will fetch
// Google's public JWKS automatically for verifyIdToken() without needing
// a private key. This supports local development without a service account JSON.

const fs = require('fs');
const path = require('path');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'mdfashionmysql';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (!admin.apps.length) {
  try {
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin initialized with serviceAccountKey.json credentials.');
    } else if (CLIENT_EMAIL && PRIVATE_KEY) {
      // Full service account from environment variables — production mode
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: PROJECT_ID,
          clientEmail: CLIENT_EMAIL,
          privateKey: PRIVATE_KEY
        })
      });
      console.log('✅ Firebase Admin initialized with service account credentials from env.');
    } else {
      // No service account — init with projectId only.
      admin.initializeApp({ projectId: PROJECT_ID });
      console.log(`✅ Firebase Admin initialized with projectId: ${PROJECT_ID} (public key verification mode).`);
    }
  } catch (initError) {
    console.error('Firebase Admin initialization error:', initError.message);
  }
} else {
  console.log('ℹ️ Firebase Admin already initialized.');
}

// Firestore is not used for business data — mock for compatibility
const createMockDb = () => {
  const mockRef = {
    where: () => mockRef,
    onSnapshot: () => {},
    doc: () => mockRef,
    collection: () => mockRef,
    get: async () => ({ docs: [], empty: true, exists: false }),
    set: async () => {},
    update: async () => {},
    delete: async () => {}
  };
  return {
    collection: () => mockRef,
    doc: () => mockRef,
    runTransaction: async () => {}
  };
};

const db = createMockDb();

module.exports = { db, admin };
