const EscPosEncoder = require('esc-pos-encoder');
const printerManager = require('../services/printerManager');

/**
 * Formats numbers in standard currency style (e.g. 1,20,000)
 */
function formatCurrency(amount) {
  const num = Number(amount || 0);
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

class PrinterController {
  /**
   * GET /api/v1/printer/status
   * Checks connection status of the printer
   */
  async checkStatus(req, res) {
    const { ip, port } = req.query;

    if (!ip) {
      return res.status(400).json({ success: false, message: 'Printer IP address is required' });
    }

    try {
      const status = await printerManager.checkStatus(ip, port || 9100);
      return res.status(200).json({ success: true, status });
    } catch (error) {
      console.error('[PrinterController] Status check failed:', error);
      return res.status(500).json({ success: false, status: 'offline', error: error.message });
    }
  }

  /**
   * POST /api/v1/printer/test
   * Prints a test receipt to verify setup and alignment
   */
  async printTest(req, res) {
    const { ip, port, paperWidth, printerName } = req.body;

    if (!ip) {
      return res.status(400).json({ success: false, message: 'Printer IP address is required' });
    }

    const width = Number(paperWidth || 80);
    const is80 = width === 80;
    const lineLen = is80 ? 48 : 32;
    const separator = '-'.repeat(lineLen);

    try {
      const encoder = new EscPosEncoder();
      const rawBytes = encoder
        .initialize()
        .align('center')
        .size('double')
        .text('MD FASHION')
        .newline()
        .size('normal')
        .text('L U X U R Y')
        .newline()
        .text(separator)
        .newline()
        .align('left')
        .text(`Test Printer: ${printerName || 'WiFi POS Printer'}`)
        .newline()
        .text(`IP Address:   ${ip}`)
        .newline()
        .text(`Port:         ${port || 9100}`)
        .newline()
        .text(`Paper Width:  ${width}mm (${lineLen} chars/line)`)
        .newline()
        .text(`Time:         ${new Date().toLocaleString('en-IN')}`)
        .newline()
        .text(separator)
        .newline()
        .align('center')
        .text('CONNECTION SUCCESSFUL!')
        .newline()
        .newline()
        .qrcode('MD FASHION TEST PRINT', 2, 6, 'h')
        .newline()
        .newline()
        .text('Thank you for choosing MD Fashion!')
        .newline()
        .text(separator)
        .newline()
        .cut()
        .encode();

      await printerManager.print(ip, port || 9100, rawBytes);
      return res.status(200).json({ success: true, message: 'Test page printed successfully' });
    } catch (error) {
      console.error('[PrinterController] Test print failed:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/v1/printer/print
   * Formats and prints a sales invoice
   */
  async printReceipt(req, res) {
    const { ip, port, paperWidth, bill } = req.body;

    if (!ip) {
      return res.status(400).json({ success: false, message: 'Printer IP address is required' });
    }
    if (!bill) {
      return res.status(400).json({ success: false, message: 'Bill data is required' });
    }

    const width = Number(paperWidth || 80);
    const is80 = width === 80;
    const lineLen = is80 ? 48 : 32;
    const separator = '-'.repeat(lineLen);
    const dSeparator = '='.repeat(lineLen);

    // Address-Only Thermal Print
    if (bill.isAddressOnly || req.body.isAddressOnly) {
      try {
        const encoder = new EscPosEncoder();
        let enc = encoder.initialize().raw([0x1b, 0x45, 0x01]); // Bold ON

        // Word wrap helper
        const wrap = (text, maxLen) => {
          if (!text) return [];
          const lines = [];
          const paragraphs = String(text).split(/\r?\n/);
          for (const para of paragraphs) {
            const words = para.trim().split(/\s+/);
            let cur = '';
            for (const w of words) {
              if (!w) continue;
              if (!cur) cur = w;
              else if ((cur + ' ' + w).length <= maxLen) cur += ' ' + w;
              else { lines.push(cur); cur = w; }
            }
            if (cur) lines.push(cur);
          }
          return lines;
        };

        enc = enc
          .align('center')
          .size('double')
          .raw([0x1b, 0x45, 0x01])
          .text('MD FASHIONS')
          .newline()
          .size('normal')
          .raw([0x1b, 0x45, 0x01])
          .text('CUSTOMER DELIVERY ADDRESS')
          .newline()
          .text(dSeparator)
          .newline()
          .align('left');

        if (bill.orderId || bill.invoiceId) {
          enc = enc.text(`Order ID : ${bill.orderId || bill.invoiceId}`).newline();
        }
        if (bill.customerName) {
          enc = enc.bold(true).text(`Customer : ${bill.customerName}`).newline();
        }
        if (bill.customerPhone && bill.customerPhone !== 'N/A') {
          enc = enc.bold(true).text(`Phone    : ${bill.customerPhone}`).newline();
        }
        if (bill.customerEmail && bill.customerEmail !== 'N/A') {
          enc = enc.text(`Email    : ${bill.customerEmail}`).newline();
        }

        enc = enc
          .text(separator)
          .newline()
          .bold(true)
          .text('Delivery Address:')
          .newline();

        const addressStr = bill.address || bill.shippingAddress || bill.customer_address || '';
        const lines = wrap(addressStr, lineLen);
        if (lines.length > 0) {
          lines.forEach(l => { enc = enc.bold(true).text(l).newline(); });
        } else {
          enc = enc.text('No delivery address specified').newline();
        }

        enc = enc
          .text(dSeparator)
          .newline()
          .align('center')
          .newline()
          .text('MD FASHIONS LUXURY JEWELLERY')
          .newline()
          .text('www.mdfashions.in')
          .newline()
          .newline()
          .raw([0x1b, 0x45, 0x00])
          .cut()
          .encode();

        await printerManager.print(ip, port || 9100, enc);
        return res.status(200).json({ success: true, message: 'Delivery address printed successfully' });
      } catch (err) {
        console.error('[PrinterController] Address print failed:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
    }

    try {
      const encoder = new EscPosEncoder();
      let enc = encoder.initialize().raw([0x1b, 0x45, 0x01]); // ESC E 1 (Bold ON)

      // --- Header ---
      enc = enc
        .align('center')
        .size('double')
        .raw([0x1b, 0x45, 0x01]) // Bold ON
        .text('MD FASHION')
        .newline()
        .size('normal')
        .raw([0x1b, 0x45, 0x01]) // Bold ON
        .text('L U X U R Y   S H O W R O O M')
        .newline()
        .text(bill.branchName || 'Main Branch')
        .newline()
        .text(bill.branchAddress || '5 R P.Jaya paradise chitra nagar, saravanampatti,coimbatore 641035')
        .newline()
        .text(`Phone: ${bill.branchPhone || '9944721243'}`)
        .newline();

      if (bill.branchPhone2) {
        enc = enc.text(`Phone 2: ${bill.branchPhone2}`).newline();
      }

      enc = enc
        .text(dSeparator)
        .newline()
        .bold(true)
        .text('✓ VERIFIED BILL')
        .newline()
        .bold(true)
        .text(dSeparator)
        .newline();

      // --- CUSTOMER DETAILS ---
      const dateStr = new Date(bill.timestamp?.toDate ? bill.timestamp.toDate() : (bill.timestamp || Date.now())).toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      enc = enc
        .align('left')
        .bold(true)
        .text('CUSTOMER DETAILS')
        .newline()
        .bold(true)
        .text(separator)
        .newline()
        .text(`Invoice No: ${bill.invoiceId || bill.orderId || 'N/A'}`).newline()
        .text(`Date/Time : ${dateStr}`).newline()
        .text(`Customer  : ${bill.customerName || 'Walk-in'}`).newline();

      const phone = bill.customerPhone || bill.customerMobile;
      if (phone && phone !== 'N/A') {
        enc = enc.text(`Phone     : ${phone}`).newline();
      }
      enc = enc
        .text(`Payment   : ${bill.paymentMethod || 'CASH'}`)
        .newline()
        .text(separator)
        .newline();

      // --- PRODUCT DETAILS ---
      enc = enc
        .bold(true)
        .text('PRODUCT DETAILS')
        .newline()
        .bold(true)
        .text(separator)
        .newline();

      if (is80) {
        // 80mm columns: Name (24), Qty (4), Rate (10), Amount (10) -> Total 48 chars
        const descH = 'Description'.padEnd(24);
        const qtyH = 'Qty'.padStart(4);
        const rateH = 'Rate'.padStart(10);
        const amtH = 'Amount'.padStart(10);
        enc = enc.text(`${descH}${qtyH}${rateH}${amtH}`).newline();
        enc = enc.text(separator).newline();

        bill.items.forEach(item => {
          const name = item.productName || item.name || 'Jewellery Item';
          const displayName = name.length > 24 ? name.substring(0, 23) + '…' : name.padEnd(24);
          const qty = String(item.quantity || 1).padStart(4);
          const rate = formatCurrency(item.sellingPrice || item.price || 0).padStart(10);
          const amount = formatCurrency((item.sellingPrice || item.price || 0) * (item.quantity || 1)).padStart(10);
          enc = enc.text(`${displayName}${qty}${rate}${amount}`).newline();

          if (item.selectedAttachment) {
            enc = enc.text(`  - Attachment: ${item.selectedAttachment.name} (+Rs.${Math.round(item.selectedAttachment.price)})`).newline();
          }
          if (item.selectedComboOption) {
            enc = enc.text(`  - Option: ${item.selectedComboOption}`).newline();
          }
          if (item.selectedAttachments && Array.isArray(item.selectedAttachments)) {
            item.selectedAttachments.forEach(att => {
              enc = enc.text(`  - Attachment: ${att.name} (+Rs.${Math.round(att.price)})`).newline();
            });
          }
        });
      } else {
        // 58mm: Two lines per item to prevent squeezing
        enc = enc.text('Item Description                ').newline();
        enc = enc.text(separator).newline();

        bill.items.forEach(item => {
          const name = item.productName || item.name || 'Jewellery Item';
          enc = enc.text(name.substring(0, 32)).newline();
          
          const qtyStr = `  ${item.quantity || 1} x Rs.${Math.round(item.sellingPrice || item.price || 0)}`;
          const totalAmtStr = `Rs.${Math.round((item.sellingPrice || item.price || 0) * (item.quantity || 1))}`;
          
          const spacesCount = 32 - qtyStr.length - totalAmtStr.length;
          const spaces = ' '.repeat(spacesCount > 0 ? spacesCount : 1);
          
          enc = enc.text(`${qtyStr}${spaces}${totalAmtStr}`).newline();

          if (item.selectedAttachment) {
            enc = enc.text(`  - Attachment: ${item.selectedAttachment.name} (+Rs.${Math.round(item.selectedAttachment.price)})`).newline();
          }
          if (item.selectedComboOption) {
            enc = enc.text(`  - Option: ${item.selectedComboOption}`).newline();
          }
          if (item.selectedAttachments && Array.isArray(item.selectedAttachments)) {
            item.selectedAttachments.forEach(att => {
              enc = enc.text(`  - Attachment: ${att.name} (+Rs.${Math.round(att.price)})`).newline();
            });
          }
        });
      }

      enc = enc.text(separator).newline();

      // --- BILL SUMMARY ---
      enc = enc
        .bold(true)
        .text('BILL SUMMARY')
        .newline()
        .bold(true)
        .text(separator)
        .newline();

      const totalAmount = Number(bill.totalAmount || 0);
      const discount = Number(bill.discount || 0);
      const gstRate = 0.03; // 3% jewellery GST
      const gstAmount = typeof bill.gst !== 'undefined' ? Number(bill.gst) : (totalAmount - (totalAmount / (1 + gstRate)));
      const subtotal = Number(bill.subtotal) || (totalAmount + discount - gstAmount);

      const splitGst = gstAmount / 2;

      // Formatting helper for currency labels
      const formatSummaryLine = (label, value) => {
        const valStr = `Rs. ${formatCurrency(value)}`;
        const spaces = ' '.repeat(Math.max(1, lineLen - label.length - valStr.length));
        return `${label}${spaces}${valStr}`;
      };

      enc = enc
        .text(formatSummaryLine('Subtotal (Excl. GST)', subtotal))
        .newline();

      if (discount > 0) {
        const label = bill.couponCode ? `Discount (${bill.couponCode})` : 'Discount';
        const valStr = `-Rs. ${formatCurrency(discount)}`;
        const spaces = ' '.repeat(Math.max(1, lineLen - label.length - valStr.length));
        enc = enc.text(`${label}${spaces}${valStr}`).newline();
      }

      // Dynamic Tax Breakdown
      if (gstAmount > 0) {
        if (bill.taxBreakdown && Array.isArray(bill.taxBreakdown) && bill.taxBreakdown.length > 0) {
          bill.taxBreakdown.forEach(tax => {
            if (tax.amount > 0) {
              const rateLabel = tax.rate ? ` (${tax.rate}%)` : '';
              const name = `${tax.name || 'Tax'}${rateLabel}`;
              enc = enc.text(formatSummaryLine(name, tax.amount)).newline();
            }
          });
        } else {
          enc = enc
            .text(formatSummaryLine('CGST (1.5%)', splitGst))
            .newline()
            .text(formatSummaryLine('SGST (1.5%)', splitGst))
            .newline();
        }
      }

      // Round off
      const roundedTotal = Math.round(totalAmount);
      const roundOff = roundedTotal - totalAmount;
      if (Math.abs(roundOff) > 0.001) {
        const valStr = `${roundOff > 0 ? '+' : ''}Rs. ${formatCurrency(roundOff)}`;
        const label = 'Round Off';
        const spaces = ' '.repeat(Math.max(1, lineLen - label.length - valStr.length));
        enc = enc.text(`${label}${spaces}${valStr}`).newline();
      }

      enc = enc
        .text(dSeparator)
        .newline()
        .size('double')
        .raw([0x1b, 0x45, 0x01]) // Bold ON
        .align('center')
        .text('GRAND TOTAL')
        .newline()
        .text(`Rs. ${roundedTotal.toLocaleString('en-IN')}`)
        .newline()
        .size('normal')
        .raw([0x1b, 0x45, 0x01]) // Bold ON
        .text(dSeparator)
        .newline();

      // --- QR Code Section ---
      const invoiceId = bill.invoiceId || bill.orderId || '';
      enc = enc
        .align('center')
        .newline()
        .qrcode(invoiceId, 2, 6, 'h')
        .newline()
        .text('Scan to Verify Invoice')
        .newline()
        .text(separator)
        .newline();

      // --- Footer Terms ---
      enc = enc
        .align('center')
        .text(separator)
        .newline()
        .newline()
        .text('Thank You For Choosing MD Fashion')
        .newline()
        .newline()
        .text('We Appreciate Your Trust and Patronage')
        .newline()
        .newline()
        .text('Visit Again')
        .newline()
        .newline()
        .text(separator)
        .newline()
        .raw([0x1b, 0x45, 0x00]) // ESC E 0 (Bold OFF)
        .cut()
        .encode();

      await printerManager.print(ip, port || 9100, enc);
      return res.status(200).json({ success: true, message: 'Print command successfully sent to printer' });
    } catch (error) {
      console.error('[PrinterController] Print failed:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new PrinterController();
