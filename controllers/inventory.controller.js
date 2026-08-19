const { db } = require('../config/firebase.config');

exports.getAllProducts = async (req, res) => {
  try {
    const snapshot = await db.collection('products').get();
    const productsList = [];
    snapshot.forEach(doc => {
      productsList.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json(productsList);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getProductByQRCode = async (req, res) => {
  const qrcode = req.query.qrcode || req.params.qrcode || req.query.barcode || req.params.barcode;
  try {
    const q = await db.collection('products').where('qrCode', '==', qrcode).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      res.status(200).json({ success: true, product: { id: doc.id, ...doc.data() } });
    } else {
      res.status(404).json({ success: false, message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addProduct = async (req, res) => {
  try {
    const newProduct = {
      ...req.body,
      createdAt: new Date().toISOString()
    };
    const docRef = await db.collection('products').add(newProduct);
    res.status(201).json({ id: docRef.id, ...newProduct });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await db.collection('products').doc(id).update(req.body);
    res.status(200).json({ id, ...req.body });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await db.collection('products').doc(id).delete();
    res.status(200).json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
