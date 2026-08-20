const db = require('../config/db');

// Helper to format normalized product response with field sanitization
const formatProductResponse = (p, isStaff = false) => {
  const imgUrl = (p.image_url || '').trim();
  const stockVal = Number(p.stock || 0);
  const selPrice = Number(p.price || 0);
  const oldPriceVal = p.old_price !== null && p.old_price !== undefined && Number(p.old_price) > 0 ? Number(p.old_price) : null;
  const prodIdStr = p.barcode || p.qr_code || `MD-${p.id}`;

  const response = {
    id: p.id,
    productId: prodIdStr,
    barcode: p.barcode || p.qr_code || `MD-${p.id}`,
    qrCode: p.qr_code || p.barcode || `MD-${p.id}`,
    name: p.name,
    productName: p.name,
    category: p.category || '',
    categoryId: p.category || '',
    brand: p.brand || '',
    brandId: p.brand || '',
    price: selPrice,
    sellingPrice: selPrice,
    oldPrice: oldPriceVal,
    old_price: oldPriceVal,
    mrp: oldPriceVal,
    originalPrice: oldPriceVal,
    stock: stockVal,
    availableStock: stockVal,
    imageUrl: imgUrl,
    images: imgUrl ? [imgUrl] : [],
    description: p.description || '',
    isActive: p.is_active !== undefined ? Boolean(p.is_active) : true,
    isTrending: p.is_trending !== undefined ? Boolean(p.is_trending) : false,
    trending: p.is_trending !== undefined ? Boolean(p.is_trending) : false,
    isPremium: p.is_premium !== undefined ? Boolean(p.is_premium) : (p.category || '').toLowerCase().includes('premium'),
    weight: Number(p.weight || 0),
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };

  // Strictly restrict sensitive purchase/cost prices to authenticated staff
  if (isStaff) {
    const costPrice = Number(p.cost_price || 0);
    response.purchasePrice = costPrice;
    response.costPrice = costPrice;
    response.cost_price = costPrice;
  }

  return response;
};

// Get all products
exports.getAllProducts = async (req, res) => {
  try {
    const isStaff = Boolean(req.user && ['admin', 'manager', 'staff', 'billing', 'owner'].includes(req.user.role?.toLowerCase()));
    const [rows] = await db.query('SELECT * FROM products ORDER BY id DESC');
    const formatted = rows.map(p => formatProductResponse(p, isStaff));
    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single product
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const isStaff = Boolean(req.user && ['admin', 'manager', 'staff', 'billing', 'owner'].includes(req.user.role?.toLowerCase()));
    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? OR barcode = ? OR qr_code = ?',
      [id, id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json(formatProductResponse(rows[0], isStaff));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// QR / Barcode lookup
exports.getProductByQRCode = async (req, res) => {
  try {
    const code = req.params.barcode || req.params.qrcode || req.query.code;
    if (!code) {
      return res.status(400).json({ message: 'Code required' });
    }
    const isStaff = Boolean(req.user && ['admin', 'manager', 'staff', 'billing', 'owner'].includes(req.user.role?.toLowerCase()));
    const [rows] = await db.query(
      'SELECT * FROM products WHERE barcode = ? OR qr_code = ? OR id = ? LIMIT 1',
      [code, code, code]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json(formatProductResponse(rows[0], isStaff));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create new product
exports.createProduct = async (req, res) => {
  try {
    const {
      productName,
      name,
      productId,
      barcode,
      qrCode,
      category,
      brand,
      brandId,
      sellingPrice,
      price,
      oldPrice,
      old_price,
      mrp,
      purchasePrice,
      cost_price,
      weight,
      stock,
      quantity,
      imageUrl,
      image_url,
      description,
      isActive,
      isTrending,
      trending,
      isPremium
    } = req.body;

    const pName = name || productName;
    const pBarcode = barcode || productId || qrCode;
    const pQrCode = qrCode || productId || barcode;
    const pCategory = category || 'Uncategorized';
    const pBrand = brand || brandId || null;
    const pPrice = price || sellingPrice || 0;
    const rawOldPrice = old_price !== undefined ? old_price : (oldPrice !== undefined ? oldPrice : mrp);
    const pOldPrice = (rawOldPrice !== undefined && rawOldPrice !== null && rawOldPrice !== '') ? Number(rawOldPrice) : null;
    const pCostPrice = cost_price || purchasePrice || 0;
    const pStock = stock !== undefined ? stock : (quantity || 0);
    const pImage = image_url || imageUrl || '';

    const [result] = await db.query(
      `INSERT INTO products 
       (name, barcode, qr_code, category, brand, price, old_price, cost_price, weight, stock, image_url, description, is_active, is_trending, is_premium)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pName,
        pBarcode,
        pQrCode,
        pCategory,
        pBrand,
        pPrice,
        pOldPrice,
        pCostPrice,
        weight || 0,
        pStock,
        pImage,
        description || null,
        isActive !== undefined ? (isActive ? 1 : 0) : 1,
        (isTrending || trending) ? 1 : 0,
        isPremium ? 1 : 0
      ]
    );

    res.status(201).json({ success: true, id: result.insertId, ...req.body });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.addProduct = exports.createProduct;

// Update product
exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const {
    delta,
    name,
    productName,
    barcode,
    qrCode,
    category,
    brand,
    brandId,
    price,
    sellingPrice,
    oldPrice,
    old_price,
    mrp,
    cost_price,
    purchasePrice,
    weight,
    stock,
    quantity,
    image_url,
    imageUrl,
    description,
    isActive,
    isTrending,
    trending,
    isPremium
  } = req.body;

  try {
    // If incremental delta stock adjustment is requested
    if (delta !== undefined && delta !== null) {
      const numDelta = Number(delta);
      if (isNaN(numDelta)) {
        return res.status(400).json({ success: false, message: 'Invalid quantity' });
      }

      // Check current product stock first
      const [existing] = await db.query(
        'SELECT * FROM products WHERE id = ? OR barcode = ? OR qr_code = ? LIMIT 1',
        [id, id, id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      const prevStock = Number(existing[0].stock || 0);

      // If stock reduction is requested, check for sufficient stock
      if (numDelta < 0) {
        const absDecrease = Math.abs(numDelta);
        if (prevStock < absDecrease) {
          return res.status(409).json({ 
            success: false, 
            message: `Insufficient stock. Available: ${prevStock}, requested reduction: ${absDecrease}`,
            currentStock: prevStock,
            availableStock: prevStock
          });
        }

        const [updateRes] = await db.query(
          `UPDATE products SET stock = stock - ? WHERE (id = ? OR barcode = ? OR qr_code = ?) AND stock >= ?`,
          [absDecrease, id, id, id, absDecrease]
        );

        if (updateRes.affectedRows === 0) {
          return res.status(409).json({ success: false, message: 'Insufficient stock during update' });
        }
      } else if (numDelta > 0) {
        await db.query(
          `UPDATE products SET stock = stock + ? WHERE id = ? OR barcode = ? OR qr_code = ?`,
          [numDelta, id, id, id]
        );
      }

      // Read final authoritative stock after atomic update
      const [updatedRows] = await db.query(
        'SELECT * FROM products WHERE id = ? OR barcode = ? OR qr_code = ? LIMIT 1',
        [id, id, id]
      );
      
      const updatedP = updatedRows[0];
      const newStockVal = Number(updatedP.stock || 0);
      const normalizedP = formatProductResponse(updatedP);

      return res.status(200).json({
        success: true,
        id: updatedP.id,
        productId: normalizedP.productId,
        previousStock: prevStock,
        delta: numDelta,
        newStock: newStockVal,
        stock: newStockVal,
        availableStock: newStockVal,
        product: normalizedP
      });
    }

    const pName = name || productName;
    const pBarcode = barcode || qrCode;
    const pBrand = brand || brandId;
    const pPrice = price || sellingPrice;
    const hasOldPriceKey = old_price !== undefined || oldPrice !== undefined || mrp !== undefined;
    const rawOldPrice = old_price !== undefined ? old_price : (oldPrice !== undefined ? oldPrice : mrp);
    const pOldPrice = hasOldPriceKey ? ((rawOldPrice !== null && rawOldPrice !== '') ? Number(rawOldPrice) : null) : undefined;
    const pCostPrice = cost_price || purchasePrice;
    const pStock = stock !== undefined ? stock : quantity;
    const pImage = image_url || imageUrl;
    const actVal = isActive !== undefined ? (isActive ? 1 : 0) : null;
    const trnVal = (isTrending !== undefined || trending !== undefined) ? ((isTrending || trending) ? 1 : 0) : null;
    const prmVal = isPremium !== undefined ? (isPremium ? 1 : 0) : null;

    await db.query(
      `UPDATE products 
       SET name = COALESCE(?, name),
           barcode = COALESCE(?, barcode),
           qr_code = COALESCE(?, qr_code),
           category = COALESCE(?, category),
           brand = COALESCE(?, brand),
           price = COALESCE(?, price),
           old_price = CASE WHEN ? = 1 THEN ? ELSE old_price END,
           cost_price = COALESCE(?, cost_price),
           weight = COALESCE(?, weight),
           stock = COALESCE(?, stock),
           image_url = COALESCE(?, image_url),
           description = COALESCE(?, description),
           is_active = COALESCE(?, is_active),
           is_trending = COALESCE(?, is_trending),
           is_premium = COALESCE(?, is_premium)
       WHERE id = ? OR barcode = ? OR qr_code = ?`,
      [
        pName || null,
        pBarcode || null,
        pBarcode || null,
        category || null,
        pBrand || null,
        pPrice !== undefined ? pPrice : null,
        hasOldPriceKey ? 1 : 0,
        pOldPrice !== undefined ? pOldPrice : null,
        pCostPrice !== undefined ? pCostPrice : null,
        weight !== undefined ? weight : null,
        pStock !== undefined ? pStock : null,
        pImage || null,
        description || null,
        actVal,
        trnVal,
        prmVal,
        id,
        id,
        id
      ]
    );

    res.status(200).json({ success: true, id, ...req.body });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM products WHERE id = ? OR barcode = ? OR qr_code = ?', [id, id, id]);
    res.status(200).json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Categories
exports.getCategories = async (req, res) => {
  try {
    // Auto-sync missing categories from products table into categories table
    const [distinctProds] = await db.query(
      "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) != ''"
    );
    for (const row of distinctProds) {
      const catName = row.category.toUpperCase().trim();
      const code = catName.substring(0, 3).toUpperCase();
      await db.query(
        "INSERT IGNORE INTO categories (name, code, status) VALUES (?, ?, 'ACTIVE')",
        [catName, code]
      );
    }

    const [rows] = await db.query('SELECT * FROM categories ORDER BY name ASC');
    const formatted = rows.map(c => {
      let subcats = [];
      if (c.subcategories) {
        try {
          subcats = JSON.parse(c.subcategories);
        } catch {
          subcats = typeof c.subcategories === 'string'
            ? c.subcategories.split(',').map(s => s.trim()).filter(Boolean)
            : [];
        }
      }
      return {
        id: c.id,
        categoryName: c.name,
        categoryCode: c.code || (c.name || '').substring(0, 3).toUpperCase(),
        description: c.description || '',
        subcategories: Array.isArray(subcats) ? subcats : [],
        trending: false,
        status: (c.status || 'ACTIVE').toUpperCase(),
        shippingCharge: Number(c.shipping_charge || 0),
        freeDelivery: Boolean(c.free_delivery)
      };
    });
    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { categoryName, categoryCode, subcategories, description, shippingCharge, freeDelivery, status } = req.body;
    const name = (categoryName || '').toUpperCase().trim();
    const code = (categoryCode || name.substring(0, 3)).toUpperCase().trim();
    const desc = description || '';
    const subcatStr = Array.isArray(subcategories) 
      ? JSON.stringify(subcategories)
      : (typeof subcategories === 'string' && subcategories.trim() 
          ? JSON.stringify(subcategories.split(',').map(s => s.trim()).filter(Boolean)) 
          : JSON.stringify([]));
    const sCharge = Number(shippingCharge || 0);
    const fDel = freeDelivery ? 1 : 0;
    const stat = status || 'ACTIVE';

    const [result] = await db.query(
      `INSERT INTO categories (name, code, subcategories, description, shipping_charge, free_delivery, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         code = VALUES(code),
         subcategories = VALUES(subcategories),
         description = VALUES(description),
         shipping_charge = VALUES(shipping_charge),
         free_delivery = VALUES(free_delivery),
         status = VALUES(status)`,
      [name, code, subcatStr, desc, sCharge, fDel, stat]
    );

    res.status(201).json({ success: true, id: result.insertId, ...req.body });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  const { id } = req.params;
  const { categoryName, oldCategoryName, categoryCode, subcategories, description, shippingCharge, freeDelivery, status } = req.body;

  try {
    const catName = categoryName ? categoryName.toUpperCase().trim() : null;
    const code = categoryCode ? categoryCode.toUpperCase().trim() : null;
    const desc = description !== undefined ? description : null;
    const subcatStr = subcategories !== undefined
      ? (Array.isArray(subcategories) 
          ? JSON.stringify(subcategories) 
          : JSON.stringify(typeof subcategories === 'string' && subcategories.trim() ? subcategories.split(',').map(s => s.trim()).filter(Boolean) : []))
      : null;
    const sCharge = shippingCharge !== undefined ? Number(shippingCharge) : null;
    const fDel = freeDelivery !== undefined ? (freeDelivery ? 1 : 0) : null;
    const stat = status !== undefined ? status : null;

    await db.query(
      `UPDATE categories 
       SET name = COALESCE(?, name),
           code = COALESCE(?, code),
           subcategories = COALESCE(?, subcategories),
           description = COALESCE(?, description),
           shipping_charge = COALESCE(?, shipping_charge),
           free_delivery = COALESCE(?, free_delivery),
           status = COALESCE(?, status)
       WHERE id = ? OR name = ? OR name = ?`,
      [catName, code, subcatStr, desc, sCharge, fDel, stat, id, id, oldCategoryName || id]
    );

    // If category name was renamed, also rename products in that category
    if (catName && oldCategoryName && oldCategoryName.toUpperCase().trim() !== catName) {
      await db.query('UPDATE products SET category = ? WHERE category = ?', [catName, oldCategoryName]);
    }

    res.status(200).json({ success: true, id, ...req.body });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  const name = req.query.name || id;
  try {
    await db.query('DELETE FROM categories WHERE id = ? OR name = ? OR name = ?', [id, id, name]);
    await db.query('DELETE FROM products WHERE category = ? OR category = ?', [id, name]);
    res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Brands
exports.getBrands = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name FROM brands ORDER BY name ASC');
    const brands = rows.map(r => ({
      id: r.id,
      name: r.name,
      brandName: r.name
    }));
    res.status(200).json(brands);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addBrand = async (req, res) => {
  try {
    const { name, brandName } = req.body;
    const bName = (name || brandName || '').trim();
    if (!bName) return res.status(400).json({ success: false, message: 'Brand name is required' });

    await db.query('INSERT IGNORE INTO brands (name) VALUES (?)', [bName]);
    res.status(201).json({ success: true, name: bName });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
