const { db } = require('../config/firebase.config');

const CATEGORY_COLORS = {
  'NECKLACE':   '#db2777',
  'NECKLACES':  '#db2777',
  'EARRING':    '#f472b6',
  'EARRINGS':   '#f472b6',
  'BANGLE':     '#ec4899',
  'BANGLES':    '#ec4899',
  'RING':       '#fbcfe8',
  'RINGS':      '#fbcfe8',
  'BRACELET':   '#be185d',
  'BRACELETS':  '#be185d',
  'PENDANT':    '#f9a8d4',
  'PENDANTS':   '#f9a8d4',
  'BRIDAL':     '#9d174d',
  'CHAIN':      '#fce7f3',
  'CHAINS':     '#fce7f3',
  'WATCH':      '#831843',
  'WATCHES':    '#831843',
};

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts._seconds) return ts._seconds * 1000;
  return new Date(ts).getTime();
};

const recalculateSummaryDocs = async () => {
  console.log('[Server SummaryService] Recalculating dashboard summaries...');
  try {
    const ordersSnap = await db.collection('orders').limit(500).get();
    const productsSnap = await db.collection('products').limit(2000).get();
    const customersSnap = await db.collection('customers').get();
    const branchesSnap = await db.collection('branches').get();

    const rawOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rawProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rawCustomers = customersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const branches = branchesSnap.docs.map(d => d.data()).filter(b => b.status === 'Active');

    const computeStats = (branchCode) => {
      const isBranchUser = !!branchCode;
      
      const filteredOrders = isBranchUser
        ? rawOrders.filter(o => o.branchCode === branchCode)
        : rawOrders;

      const filteredProducts = isBranchUser
        ? rawProducts.filter(p => p.branchCode === branchCode || !p.branchCode || p.branchCode === 'main_branch')
        : rawProducts;

      const filteredCustomers = isBranchUser
        ? rawCustomers.filter(c => filteredOrders.some(o => o.customerId === c.id || o.customerMobile === c.mobile))
        : rawCustomers;

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      const startOfThisMonth = new Date(currentYear, currentMonth, 1).getTime();
      const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1).getTime();
      const endOfLastMonth   = startOfThisMonth - 1;

      const posOrders = filteredOrders.filter(o => {
        const src = (o.orderSource || o.source || '').toUpperCase();
        return src === 'POS' || src === 'WEB' || src === '';
      });

      const totalSales = posOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
      const totalOrders = posOrders.length;

      const thisMonthOrders = posOrders.filter(o => toMs(o.timestamp || o.createdAt) >= startOfThisMonth);
      const lastMonthOrders = posOrders.filter(o => {
        const t = toMs(o.timestamp || o.createdAt);
        return t >= startOfLastMonth && t <= endOfLastMonth;
      });

      const thisMonthSales = thisMonthOrders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
      const lastMonthSales = lastMonthOrders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

      const salesTrend = lastMonthSales === 0
        ? (thisMonthSales > 0 ? 100 : 0)
        : parseFloat((((thisMonthSales - lastMonthSales) / lastMonthSales) * 100).toFixed(1));

      const ordersTrend = lastMonthOrders.length === 0
        ? (thisMonthOrders.length > 0 ? 100 : 0)
        : parseFloat((((thisMonthOrders.length - lastMonthOrders.length) / lastMonthOrders.length) * 100).toFixed(1));

      const inventoryItems = filteredProducts.filter(p => p.status !== 'DELETED').length;
      const inventoryTrend = 0;

      const newCustomers = filteredCustomers.filter(c => toMs(c.createdAt) >= startOfThisMonth).length;
      const lastMonthNewCustomers = filteredCustomers.filter(c => {
        const t = toMs(c.createdAt);
        return t >= startOfLastMonth && t <= endOfLastMonth;
      }).length;
      
      const customersTrend = lastMonthNewCustomers === 0
        ? (newCustomers > 0 ? 100 : 0)
        : parseFloat((((newCustomers - lastMonthNewCustomers) / lastMonthNewCustomers) * 100).toFixed(1));

      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const weeklyMap = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        weeklyMap[key] = {
          name: i === 0 ? 'Today' : DAY_LABELS[d.getDay()],
          sales: 0,
          orders: 0,
        };
      }

      posOrders.forEach(o => {
        const ms = toMs(o.timestamp || o.createdAt);
        if (!ms) return;
        const d = new Date(ms);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (weeklyMap[key]) {
          weeklyMap[key].sales  += Number(o.totalAmount) || 0;
          weeklyMap[key].orders += 1;
        }
      });
      const weeklyChartData = Object.values(weeklyMap);

      const catMap = {};
      filteredProducts.filter(p => p.status !== 'DELETED').forEach(p => {
        const cat = (p.category || 'Other').trim().toUpperCase();
        const stock = Number(p.stock ?? p.quantity ?? 0);
        catMap[cat] = (catMap[cat] || 0) + Math.max(0, stock);
      });

      const categoryChartData = Object.entries(catMap)
        .map(([name, value]) => ({
          name,
          value,
          color: CATEGORY_COLORS[name] || '#ec4899',
        }))
        .filter(c => c.value > 0)
        .sort((a, b) => b.value - a.value);

      const recentTransactions = [...posOrders]
        .sort((a, b) => toMs(b.timestamp || b.createdAt) - toMs(a.timestamp || a.createdAt))
        .slice(0, 5)
        .map(o => ({
          id: o.id,
          invoiceId: o.invoiceId || o.orderId || o.id,
          customerName: o.customerName || 'Walk-in',
          totalAmount: Number(o.totalAmount) || 0,
          paymentStatus: o.paymentStatus || 'PAID',
          timestamp: toMs(o.timestamp || o.createdAt),
          branchName: (o.orderSource || o.source || '').toUpperCase() === 'WEB' ? 'Web' : (o.branchName || 'Main Branch'),
        }));

      const lowStockItems = filteredProducts
        .filter(p => p.status !== 'DELETED' && (Number(p.stock) || 0) < 5)
        .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
        .slice(0, 5)
        .map(p => ({
          id: p.id,
          name: p.name || p.productName || 'Unknown Product',
          productId: p.productId || p.id,
          category: p.category || '—',
          stock: Number(p.stock) || 0,
        }));

      return {
        totalSales,
        totalOrders,
        inventoryItems,
        newCustomers,
        salesTrend,
        ordersTrend,
        inventoryTrend,
        customersTrend,
        weeklyChartData,
        categoryChartData,
        recentTransactions,
        lowStockItems,
      };
    };

    const globalStats = computeStats(null);
    await db.collection('summaries').doc('dashboardStats').set({
      ...globalStats,
      updatedAt: new Date().toISOString()
    });

    for (const br of branches) {
      if (br.code) {
        const branchStats = computeStats(br.code);
        await db.collection('summaries').doc(`branch_${br.code}`).set({
          ...branchStats,
          updatedAt: new Date().toISOString()
        });
      }
    }

    console.log('[Server SummaryService] Recalculation complete.');
  } catch (err) {
    console.error('[Server SummaryService] Recalculation failed:', err);
  }
};

module.exports = { recalculateSummaryDocs };
