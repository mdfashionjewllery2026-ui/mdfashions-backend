const ExcelJS = require('exceljs');
const { db, admin } = require('../config/firebase.config');

// Helper to determine start and end dates
const getDateRange = (dateRange, customStart, customEnd) => {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  // Set end to end of today
  end.setHours(23, 59, 59, 999);

  switch (dateRange) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'custom':
      if (customStart) {
        start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
      } else {
        start = new Date(0); // Epoch
      }
      if (customEnd) {
        end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
      }
      break;
    case 'all':
    default:
      return null;
  }
  return { start, end };
};

// Helper to convert Firestore timestamp to JS Date
const parseFirestoreDate = (fieldVal) => {
  if (!fieldVal) return new Date();
  if (fieldVal.toDate && typeof fieldVal.toDate === 'function') {
    return fieldVal.toDate();
  }
  if (fieldVal._seconds) {
    return new Date(fieldVal._seconds * 1000);
  }
  return new Date(fieldVal);
};

// Excel formatting helper
const applyStandardExcelFormatting = (ws, title, metadata = {}) => {
  // Title Block
  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'MD FASHIONS — LUXURY JEWELLERY';
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFF1B6B' } }; // Brand pink color
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 30;

  // Metadata Subheader
  ws.mergeCells('A2:J2');
  const metaCell = ws.getCell('A2');
  const metaText = Object.entries(metadata)
    .map(([key, val]) => `${key}: ${val}`)
    .join('  |  ');
  metaCell.value = metaText;
  metaCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF64748B' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(2).height = 20;

  // Row 3: Generated Date & Time
  ws.mergeCells('A3:J3');
  const genCell = ws.getCell('A3');
  genCell.value = `Generated on: ${new Date().toLocaleString('en-IN')} (IST)`;
  genCell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
  genCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(3).height = 18;

  ws.getRow(4).height = 10; // spacing row

  // Freeze rows 1-5 (headers are on row 5)
  ws.views = [
    {
      state: 'frozen',
      ySplit: 5,
      activeCell: 'A6'
    }
  ];
};
exports.exportExcelReport = async (req, res) => {
  const inputSource = req.method === 'POST' ? req.body : req.query;
  const {
    reportType,
    dateRange,
    customStart,
    customEnd,
    branchId,
    category,
    staffId,
    paymentMethod,
    productId,
    customerId,
    orderSource,
    dataset
  } = inputSource;

  const { name: userName, role, branchId: userBranchId, branchCode: userBranchCode } = req.user;

  try {
    const workbook = new ExcelJS.Workbook();
    let sheetName = 'Report';
    let fileName = `${reportType || 'Report'}_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}.xlsx`;

    // Initialize formatting metadata
    const activeBranchName = (role === 'admin' && branchId && branchId !== 'all') ? branchId : (userBranchCode || 'All Showrooms');
    const formattingMetadata = {
      'Report Type': (reportType || '').toUpperCase().replace(/_/g, ' '),
      'Showroom': activeBranchName,
      'Date Scope': (dateRange || 'all').toUpperCase()
    };

    const ws = workbook.addWorksheet(formattingMetadata['Report Type']);
    applyStandardExcelFormatting(ws, formattingMetadata['Report Type'], formattingMetadata);

    // Apply primary filters on Firestore
    const timeLimits = getDateRange(dateRange, customStart, customEnd);

    // Define column structures and query logic based on reportType
    let headers = [];
    let rowDataList = [];
    let isMonetaryColumn = {};
    let isQuantityColumn = {};

    switch (reportType) {
      case 'sales':
      case 'billing_history':
      case 'web_orders':
      case 'daily_collection': {
        let orders;
        if (dataset) {
          orders = dataset;
        } else {
          // Query orders
          let queryRef = db.collection('orders');

          // Apply Date constraints
          if (timeLimits) {
            queryRef = queryRef
              .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(timeLimits.start))
              .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(timeLimits.end));
          }

          // Apply Manager branch constraints
          if (role === 'manager' && userBranchCode) {
            queryRef = queryRef.where('branchCode', '==', userBranchCode);
          } else if (branchId && branchId !== 'all' && branchId !== 'ALL') {
            // Admin specific filter
            queryRef = queryRef.where('branchCode', '==', branchId);
          }

          const snapshot = await queryRef.get();
          orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // In-memory business filtering to avoid needing complex composite index configurations
        if (orderSource && orderSource !== 'ALL') {
          orders = orders.filter(o => (o.orderSource || o.source || '').toUpperCase() === orderSource.toUpperCase());
        }
        if (paymentMethod && paymentMethod !== 'ALL') {
          orders = orders.filter(o => (o.paymentMethod || '').toUpperCase() === paymentMethod.toUpperCase());
        }
        if (staffId && staffId !== 'ALL') {
          orders = orders.filter(o => (o.cashierName || '').toLowerCase().includes(staffId.toLowerCase()));
        }
        if (customerId && customerId !== 'ALL') {
          orders = orders.filter(o => o.customerId === customerId);
        }

        if (reportType === 'sales') {
          headers = [
            'Invoice Number', 'Bill Date', 'Branch Name', 'Customer Name', 'Mobile Number',
            'Product Name', 'Category', 'Quantity', 'Rate', 'Discount', 'GST',
            'Shipping Charge', 'Final Amount', 'Payment Method', 'Staff Name', 'Invoice Status',
            'Rope Selected', 'Rope Charge', 'Back Chain Selected', 'Back Chain Charge',
            'Combo Product', 'Necklace Selected', 'Earrings Selected', 'Additional Charges',
            'Product QR Code', 'Product SKU'
          ];
          isMonetaryColumn = { 8: true, 9: true, 10: true, 11: true, 12: true, 17: true, 19: true, 23: true };
          isQuantityColumn = { 7: true };

          orders.forEach(order => {
            const dateStr = parseFirestoreDate(order.timestamp).toLocaleString('en-IN');
            const items = order.items || [];
            items.forEach(item => {
              // In-memory filter on item details
              if (category && category !== 'ALL' && (item.category || '').toUpperCase() !== category.toUpperCase()) return;
              if (productId && productId !== 'ALL' && item.productId !== productId) return;

              rowDataList.push([
                order.invoiceId || order.orderId || order.id,
                dateStr,
                order.branchName || 'Main Showroom',
                order.customerName || 'Walk-in',
                order.customerPhone || order.customerMobile || 'N/A',
                item.productName || item.name || 'Custom Jewellery',
                item.category || 'Jewellery',
                Number(item.quantity || 1),
                Number(item.price || item.sellingPrice || 0),
                Number(item.discountAmount || 0),
                Number(item.gst || item.totalTax || 0),
                Number(order.shipping || 0),
                Number(item.cartTotal || (item.sellingPrice * item.quantity) || 0),
                order.paymentMethod || 'CASH',
                order.cashierName || 'POS Staff',
                order.orderStatus || 'DELIVERED',
                // Jewellery-specific columns
                item.ropeSelected || item.rope || '-',
                Number(item.ropeCharge || 0),
                item.backChainSelected || item.backChain || '-',
                Number(item.backChainCharge || 0),
                item.isCombo ? 'YES' : 'NO',
                item.necklaceSelected || item.necklace || '-',
                item.earringsSelected || item.earrings || '-',
                Number(item.additionalCharges || 0),
                item.qrCode || item.productId || '-',
                item.sku || item.productId || '-'
              ]);
            });
          });

        } else if (reportType === 'billing_history') {
          headers = [
            'Invoice Number', 'Bill Date', 'Customer Name', 'Mobile Number', 'Source',
            'Showroom Name', 'Showroom Code', 'Subtotal', 'Discount', 'GST',
            'Shipping Charge', 'Total Amount', 'Payment Method', 'Payment Status', 'Order Status'
          ];
          isMonetaryColumn = { 7: true, 8: true, 9: true, 10: true, 11: true };

          orders.forEach(order => {
            const dateStr = parseFirestoreDate(order.timestamp).toLocaleString('en-IN');
            rowDataList.push([
              order.invoiceId || order.orderId || order.id,
              dateStr,
              order.customerName || 'Walk-in',
              order.customerPhone || order.customerMobile || 'N/A',
              (order.orderSource || order.source || 'POS').toUpperCase(),
              order.branchName || 'Main Showroom',
              order.branchCode || 'MB-01',
              Number(order.subtotal || 0),
              Number(order.discount || 0),
              Number(order.gst || order.totalTax || 0),
              Number(order.shipping || 0),
              Number(order.totalAmount || 0),
              order.paymentMethod || 'CASH',
              order.paymentStatus || 'PAID',
              order.orderStatus || 'DELIVERED'
            ]);
          });

        } else if (reportType === 'web_orders') {
          headers = [
            'Order Number', 'Date & Time', 'Customer Name', 'Mobile Number', 'Email',
            'Products Count', 'Subtotal', 'Discount', 'Tax', 'Shipping Charge',
            'Total Amount', 'Payment Method', 'Payment Status', 'Fulfillment Status'
          ];
          isMonetaryColumn = { 6: true, 7: true, 8: true, 9: true, 10: true };
          isQuantityColumn = { 5: true };

          orders.filter(o => (o.orderSource || o.source || '').toUpperCase() === 'WEB').forEach(order => {
            const dateStr = parseFirestoreDate(order.timestamp).toLocaleString('en-IN');
            rowDataList.push([
              order.orderId || order.invoiceId || order.id,
              dateStr,
              order.customerName || 'Online Customer',
              order.customerPhone || 'N/A',
              order.customerEmail || 'N/A',
              Number(order.items?.length || 0),
              Number(order.subtotal || 0),
              Number(order.discount || 0),
              Number(order.gst || order.totalTax || 0),
              Number(order.shipping || 0),
              Number(order.totalAmount || 0),
              order.paymentMethod || 'ONLINE',
              order.paymentStatus || 'PAID',
              order.orderStatus || 'PENDING'
            ]);
          });

        } else if (reportType === 'daily_collection') {
          headers = [
            'Invoice Number', 'Bill Date', 'Customer Name', 'Showroom Name',
            'Cash Amount', 'UPI Amount', 'Card Amount', 'Total Amount', 'Staff Name'
          ];
          isMonetaryColumn = { 4: true, 5: true, 6: true, 7: true };

          orders.forEach(order => {
            const dateStr = parseFirestoreDate(order.timestamp).toLocaleString('en-IN');
            const total = Number(order.totalAmount || 0);
            const method = (order.paymentMethod || 'CASH').toUpperCase();
            
            let cash = 0, upi = 0, card = 0;
            if (method.includes('CASH')) cash = total;
            else if (method.includes('UPI') || method.includes('GPAY') || method.includes('PHONEPE')) upi = total;
            else if (method.includes('CARD') || method.includes('CREDIT') || method.includes('DEBIT')) card = total;
            else cash = total; // default fallback

            rowDataList.push([
              order.invoiceId || order.orderId || order.id,
              dateStr,
              order.customerName || 'Walk-in',
              order.branchName || 'Main Showroom',
              cash,
              upi,
              card,
              total,
              order.cashierName || 'POS Staff'
            ]);
          });
        }
        break;
      }

      case 'inventory':
      case 'product': {
        let products;
        if (dataset) {
          products = dataset;
        } else {
          // Query products
          let queryRef = db.collection('products');
          if (category && category !== 'ALL') {
            queryRef = queryRef.where('category', '==', category);
          }
          const snapshot = await queryRef.get();
          products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // In-memory filters
        if (productId && productId !== 'ALL') {
          products = products.filter(p => p.productId === productId);
        }

        headers = [
          'Product ID', 'QR Code', 'Product Name', 'Category', 'Current Stock',
          'Sold Quantity', 'Remaining Stock', 'Purchase Price', 'Selling Price',
          'Profit Margin (%)', 'Last Updated'
        ];
        isMonetaryColumn = { 7: true, 8: true };
        isQuantityColumn = { 4: true, 5: true, 6: true };

        products.forEach(p => {
          const sold = Number(p.salesCount || 0);
          const current = Number(p.stock || p.availableStock || 0);
          const totalStock = current + sold;
          const purchase = Number(p.purchasePrice || 0);
          const selling = Number(p.sellingPrice || 0);
          const margin = purchase > 0 ? ((selling - purchase) / purchase) * 100 : 0;
          const dateStr = p.updatedAt ? parseFirestoreDate(p.updatedAt).toLocaleString('en-IN') : 'N/A';

          rowDataList.push([
            p.productId || p.id,
            p.qrCode || p.productId || p.id,
            p.productName || 'Jewellery Item',
            p.category || 'Jewellery',
            current,
            sold,
            current, // Remaining stock matches current stock
            purchase,
            selling,
            Number(margin.toFixed(2)),
            dateStr
          ]);
        });
        break;
      }

      case 'customer': {
        let customers;
        if (dataset) {
          customers = dataset;
        } else {
          // Query customers
          let queryRef = db.collection('customers').orderBy('totalSpent', 'desc');
          const snapshot = await queryRef.get();
          customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Filter by branch code if Manager
        if (role === 'manager' && userBranchCode) {
          // Customers belong to a branch if their last order belonged to it
          // Or if branchId is mapped. Let's filter customer data
          customers = customers.filter(c => c.branchCode === userBranchCode || !c.branchCode);
        }

        if (customerId && customerId !== 'ALL') {
          customers = customers.filter(c => c.id === customerId);
        }

        headers = [
          'Customer ID', 'Customer Name', 'Mobile Number', 'Total Orders',
          'Total Purchase Amount', 'Last Purchase Date', 'Branch'
        ];
        isMonetaryColumn = { 4: true };
        isQuantityColumn = { 3: true };

        customers.forEach(c => {
          const lastDate = c.lastPurchaseDate ? parseFirestoreDate(c.lastPurchaseDate).toLocaleDateString('en-IN') : 'N/A';
          rowDataList.push([
            c.id,
            c.name || 'N/A',
            c.mobile || 'N/A',
            Number(c.totalOrders || 0),
            Number(c.totalSpent || 0),
            lastDate,
            c.branchName || 'Main Showroom'
          ]);
        });
        break;
      }

      case 'profit': {
        let profitsDocs;
        if (dataset) {
          profitsDocs = dataset;
        } else {
          // Query profits collection
          let queryRef = db.collection('profits');
          if (timeLimits) {
            queryRef = queryRef
              .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(timeLimits.start))
              .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(timeLimits.end));
          }

          if (role === 'manager' && userBranchCode) {
            queryRef = queryRef.where('branchCode', '==', userBranchCode);
          } else if (branchId && branchId !== 'all' && branchId !== 'ALL') {
            queryRef = queryRef.where('branchCode', '==', branchId);
          }

          const snapshot = await queryRef.get();
          profitsDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // In-memory filters
        if (customerId && customerId !== 'ALL') {
          profitsDocs = profitsDocs.filter(p => p.customerId === customerId);
        }

        headers = [
          'Invoice Number', 'Product Name', 'Purchase Price', 'Selling Price',
          'Quantity', 'Profit Amount', 'Branch', 'Staff'
        ];
        isMonetaryColumn = { 2: true, 3: true, 5: true };
        isQuantityColumn = { 4: true };

        profitsDocs.forEach(p => {
          const items = p.items || [];
          items.forEach(item => {
            // Apply product/category filters
            if (category && category !== 'ALL' && (item.category || '').toUpperCase() !== category.toUpperCase()) return;
            if (productId && productId !== 'ALL' && item.productId !== productId) return;

            const qty = Number(item.quantity || item.cartQuantity || 1);
            const purchase = Number(item.purchasePrice || 0);
            const selling = Number(item.sellingPrice || item.cartPrice || 0);
            const profit = Number(item.profit || (item.finalSubtotal - (purchase * qty)) || 0);

            rowDataList.push([
              p.invoiceId || p.id,
              item.productName || 'Jewellery Product',
              purchase,
              selling,
              qty,
              profit,
              p.branchName || 'Main Showroom',
              p.cashierName || 'POS Staff'
            ]);
          });
        });
        break;
      }

      case 'shipping': {
        let shipments;
        if (dataset) {
          shipments = dataset;
        } else {
          // Query shipments
          let queryRef = db.collection('shipments');
          const snapshot = await queryRef.get();
          shipments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Apply filters
        if (branchId && branchId !== 'all' && branchId !== 'ALL') {
          shipments = shipments.filter(s => s.branchCode === branchId);
        }

        headers = [
          'Order Number', 'Category', 'Shipping Charge', 'Shipping Rule Applied', 'Delivery Status'
        ];
        isMonetaryColumn = { 2: true };

        shipments.forEach(s => {
          rowDataList.push([
            s.orderId || s.invoiceId || s.trackingId || s.id,
            s.courierPartner || 'Standard Courier',
            Number(s.shippingCharge || 0),
            s.shippingRule || 'Standard Delivery',
            s.status || 'Placed'
          ]);
        });
        break;
      }

      case 'branch': {
        let branches;
        if (dataset) {
          branches = dataset;
        } else {
          // Query branches
          const snapshot = await db.collection('branches').get();
          branches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        headers = [
          'Branch ID', 'Branch Name', 'Branch Code', 'Phone Number', 'Email ID',
          'Phone Number 2', 'Manager Name', 'Status', 'Location Address'
        ];

        branches.forEach(b => {
          rowDataList.push([
            b.id,
            b.name || 'N/A',
            b.code || 'N/A',
            b.phone || 'N/A',
            b.email || 'N/A',
            b.phone2 || 'N/A',
            b.manager || 'N/A',
            b.status || 'Active',
            b.address || 'N/A'
          ]);
        });
        break;
      }

      default:
        return res.status(400).json({ success: false, message: 'Invalid report type specified.' });
    }

    // Set row 5 as headers
    const headerRow = ws.getRow(5);
    headerRow.values = headers;
    headerRow.height = 24;

    headers.forEach((h, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF1B6B' } // Pink background
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Populate Data Rows
    let totalSalesVal = 0;
    let totalProfitVal = 0;
    let totalOrdersCount = 0;
    const uniqueOrders = new Set();

    rowDataList.forEach((row, rowIdx) => {
      const wsRow = ws.getRow(rowIdx + 6);
      wsRow.values = row;
      wsRow.height = 20;

      // Track summary metrics
      let invoiceNo = row[0];
      if (invoiceNo) {
        uniqueOrders.add(invoiceNo);
      }

      row.forEach((val, colIdx) => {
        const cell = wsRow.getCell(colIdx + 1);
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = { vertical: 'middle' };

        // Apply zebra striping
        if (rowIdx % 2 === 0) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF1F5' } // Very light pink tint
          };
        }

        // Apply Currency Formatting
        if (isMonetaryColumn[colIdx]) {
          cell.numFormat = '₹#,##0.00';
          cell.alignment.horizontal = 'right';

          // Accumulate metrics based on report columns
          if (reportType === 'sales' && colIdx === 12) { // Itemized final amount
            totalSalesVal += Number(val || 0);
          } else if (reportType === 'billing_history' && colIdx === 11) { // Invoice total
            totalSalesVal += Number(val || 0);
          } else if (reportType === 'web_orders' && colIdx === 10) { // Web total
            totalSalesVal += Number(val || 0);
          } else if (reportType === 'daily_collection' && colIdx === 7) { // Daily total
            totalSalesVal += Number(val || 0);
          } else if (reportType === 'profit' && colIdx === 5) { // Profit Amount
            totalProfitVal += Number(val || 0);
          } else if (reportType === 'inventory' && colIdx === 8) { // Inventory selling value
            totalSalesVal += Number(val || 0);
          }
        }

        // Apply Quantity Formatting (Right-aligned integers)
        if (isQuantityColumn[colIdx]) {
          cell.numFormat = '#,##0';
          cell.alignment.horizontal = 'right';
        }
      });
    });

    totalOrdersCount = uniqueOrders.size;

    // Append Summary / Totals Row at the bottom
    const totalRowIndex = rowDataList.length + 7;
    ws.getRow(totalRowIndex).height = 24;

    ws.getCell(`A${totalRowIndex}`).value = 'GRAND TOTALS';
    ws.getCell(`A${totalRowIndex}`).font = { name: 'Arial', size: 10, bold: true };

    // Format totals cells depending on report types
    if (reportType === 'sales' || reportType === 'billing_history' || reportType === 'web_orders' || reportType === 'daily_collection') {
      const salesColLabel = reportType === 'sales' ? 'M' : reportType === 'billing_history' ? 'L' : reportType === 'web_orders' ? 'K' : 'H';
      ws.getCell(`${salesColLabel}${totalRowIndex}`).value = totalSalesVal;
      ws.getCell(`${salesColLabel}${totalRowIndex}`).numFormat = '₹#,##0.00';
      ws.getCell(`${salesColLabel}${totalRowIndex}`).font = { name: 'Arial', size: 10, bold: true };

      // Double underline accounting style
      ws.getCell(`${salesColLabel}${totalRowIndex}`).border = {
        top: { style: 'thin' },
        bottom: { style: 'double' }
      };
      
      // Print order counts in column B
      ws.getCell(`B${totalRowIndex}`).value = `Orders: ${totalOrdersCount}`;
      ws.getCell(`B${totalRowIndex}`).font = { name: 'Arial', size: 10, bold: true };
    } else if (reportType === 'profit') {
      ws.getCell(`F${totalRowIndex}`).value = totalProfitVal;
      ws.getCell(`F${totalRowIndex}`).numFormat = '₹#,##0.00';
      ws.getCell(`F${totalRowIndex}`).font = { name: 'Arial', size: 10, bold: true };
      ws.getCell(`F${totalRowIndex}`).border = {
        top: { style: 'thin' },
        bottom: { style: 'double' }
      };

      ws.getCell(`B${totalRowIndex}`).value = `Orders: ${totalOrdersCount}`;
      ws.getCell(`B${totalRowIndex}`).font = { name: 'Arial', size: 10, bold: true };
    }

    // Auto-adjust column widths based on longest cell content
    ws.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, (cell, rowNum) => {
        // Skip metadata header cells (rows 1-4) in width calculations
        if (rowNum < 5) return;
        const cellVal = cell.value ? String(cell.value) : '';
        if (cellVal.length > maxLen) {
          maxLen = cellVal.length;
        }
      });
      column.width = Math.max(12, maxLen + 4);
    });

    // Write Export Audit Log to Firestore
    try {
      await db.collection('export_logs').add({
        userName,
        role: role.toUpperCase(),
        branch: activeBranchName,
        reportType: reportType.toUpperCase(),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (auditErr) {
      console.warn('Failed to write audit export log:', auditErr.message);
    }

    // Stream download back to client
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Excel Export Controller Error:', error);
    res.status(500).json({ success: false, message: 'Excel generation failed: ' + error.message });
  }
};
