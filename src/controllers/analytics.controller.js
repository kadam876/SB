const Order = require('../models/Order');
const Product = require('../models/Product');

// Helper: match orders belonging to this admin
const getAdminOrderMatch = async (user) => {
    // In single-shop mode, the owner sees all orders.
    return {};
};

exports.getDashboardStats = async (req, res) => {
    try {
        const user = req.user;
        console.log(`[DashboardStats] Request by User: ${user.email}, Role: ${user.role}`);

        let productMatch = { isActive: true };
        if (user.role?.toUpperCase() !== 'OWNER') productMatch.adminId = user.id;

        const totalProducts = await Product.countDocuments(productMatch);
        console.log(`[DashboardStats] Products found: ${totalProducts}`);

        const lowStockItems = await Product.countDocuments({ ...productMatch, stockQuantity: { $lt: 20 } });
        
        const orderMatch = await getAdminOrderMatch(user);
        const totalOrders = await Order.countDocuments(orderMatch);
        const revenueResult = await Order.aggregate([
            { $match: orderMatch },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;
        console.log(`[DashboardStats] Orders: ${totalOrders}, Revenue: ${totalRevenue}`);
        res.json({ totalProducts, totalOrders, lowStockItems, totalRevenue });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getFullDashboard = async (req, res) => {
    try {
        const user = req.user;
        const { period = 'month' } = req.query;
        const orderMatch = await getAdminOrderMatch(user);

        // 1. Stats
        let productMatch = { isActive: true };
        if (user.role?.toUpperCase() !== 'OWNER') productMatch.adminId = user.id;

        const totalProducts = await Product.countDocuments(productMatch);
        const lowStockItems = await Product.countDocuments({ ...productMatch, stockQuantity: { $lt: 20 } });
        const totalOrders = await Order.countDocuments(orderMatch);
        const revenueResult = await Order.aggregate([
            { $match: orderMatch },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

        // Growth
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const [currRes, prevRes] = await Promise.all([
            Order.aggregate([
                { $match: { ...orderMatch, orderDate: { $gte: thisMonthStart }, status: { $ne: 'CANCELLED' } } },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } }
            ]),
            Order.aggregate([
                { $match: { ...orderMatch, orderDate: { $gte: lastMonthStart, $lt: thisMonthStart }, status: { $ne: 'CANCELLED' } } },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } }
            ])
        ]);
        const currRevenue = currRes.length > 0 ? currRes[0].total : 0;
        const prevRevenue = prevRes.length > 0 ? prevRes[0].total : 0;
        const revGrowth = prevRevenue > 0
            ? Math.round(((currRevenue - prevRevenue) / prevRevenue) * 100)
            : (currRevenue > 0 ? 100 : 0);

        const stats = { totalProducts, lowStockItems, totalOrders, totalRevenue, revenueGrowth: revGrowth, orderGrowth: 0, productGrowth: 0, lowStockGrowth: 0 };

        // 2. Sales Over Time
        let startDate = new Date();
        if (period === 'week') startDate.setDate(startDate.getDate() - 7);
        else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);
        else startDate.setDate(startDate.getDate() - 30);

        const salesByDate = await Order.aggregate([
            { $match: { ...orderMatch, orderDate: { $gte: startDate } } },
            { $group: { _id: { $dateToString: { format: period === 'year' ? '%Y-%m' : '%Y-%m-%d', date: '$orderDate' } }, sales: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
            { $sort: { '_id': 1 } },
            { $project: { _id: 0, date: '$_id', sales: 1, orders: 1 } }
        ]);

        // 3. Category Distribution
        const categories = await Product.aggregate([
            { $match: productMatch },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $project: { _id: 0, category: { $ifNull: ['$_id', 'Uncategorized'] }, count: 1 } }
        ]);

        // 4. Order Status Distribution
        const statusDistribution = await Order.aggregate([
            { $match: orderMatch },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { _id: 0, status: { $ifNull: ['$_id', 'UNKNOWN'] }, count: 1 } }
        ]);

        // 5. Top Selling Products
        const topProducts = await Order.aggregate([
            { $match: orderMatch },
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', name: { $first: '$items.productName' }, image: { $first: '$items.productImage' }, quantity: { $sum: '$items.quantity' } } },
            { $sort: { quantity: -1 } },
            { $limit: 10 },
            { $project: { _id: 0, productId: '$_id', name: 1, image: 1, quantity: 1 } }
        ]);

        // 6. Predictions
        const baseline = totalRevenue > 0 ? totalRevenue / (period === 'year' ? 365 : period === 'week' ? 7 : 30) : 500;
        const predictions = [];
        for (let i = 1; i <= 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dow = date.getDay();
            const seasonality = (dow === 0 || dow === 6) ? 1.2 : 0.9;
            predictions.push({
                date: date.toISOString().split('T')[0],
                sales: Math.round(baseline * seasonality * (0.9 + Math.random() * 0.2))
            });
        }

        res.json({ stats, sales: { salesByDate }, categories: { categories }, orderStatus: { statusDistribution }, topProducts, predictions });
    } catch (err) {
        console.error('DASHBOARD AGGREGATION ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getGrowthData = async (req, res) => {
    try {
        const orderMatch = await getAdminOrderMatch(req.user);
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const [thisRes, lastRes] = await Promise.all([
            Order.aggregate([{ $match: { ...orderMatch, orderDate: { $gte: thisMonthStart }, status: { $ne: 'CANCELLED' } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
            Order.aggregate([{ $match: { ...orderMatch, orderDate: { $gte: lastMonthStart, $lt: thisMonthStart }, status: { $ne: 'CANCELLED' } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }])
        ]);
        const current = thisRes.length > 0 ? thisRes[0].total : 0;
        const previous = lastRes.length > 0 ? lastRes[0].total : 0;
        const percentage = previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
        res.json({ current, previous, percentage: Math.round(percentage), period: 'Month-over-Month' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getSalesData = async (req, res) => {
    try {
        const orderMatch = await getAdminOrderMatch(req.user);
        const salesByDate = await Order.aggregate([
            { $match: orderMatch },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate' } }, sales: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
            { $sort: { '_id': 1 } },
            { $project: { _id: 0, date: '$_id', sales: 1, orders: 1 } }
        ]);
        res.json(salesByDate);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getCategoryDistribution = async (req, res) => {
    try {
        const user = req.user;
        let productMatch = { isActive: true };
        if (user.role?.toUpperCase() !== 'OWNER') productMatch.adminId = user.id;

        const categories = await Product.aggregate([
            { $match: productMatch },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $project: { _id: 0, category: { $ifNull: ['$_id', 'Uncategorized'] }, count: 1 } }
        ]);
        res.json({ categories });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getOrderStatusDistribution = async (req, res) => {
    try {
        const orderMatch = await getAdminOrderMatch(req.user);
        const statusDistribution = await Order.aggregate([
            { $match: orderMatch },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { _id: 0, status: { $ifNull: ['$_id', 'UNKNOWN'] }, count: 1 } }
        ]);
        res.json({ statusDistribution });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTopSellingProducts = async (req, res) => {
    try {
        const orderMatch = await getAdminOrderMatch(req.user);
        const limit = req.query.limit ? parseInt(req.query.limit) : 10;
        const topProducts = await Order.aggregate([
            { $match: orderMatch },
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', name: { $first: '$items.productName' }, image: { $first: '$items.productImage' }, quantity: { $sum: '$items.quantity' } } },
            { $sort: { quantity: -1 } },
            { $limit: limit },
            { $project: { _id: 0, productId: '$_id', name: 1, image: 1, quantity: 1 } }
        ]);
        res.json(topProducts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getSalesPredictions = async (req, res) => {
    try {
        const orderMatch = await getAdminOrderMatch(req.user);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const salesStats = await Order.aggregate([
            { $match: { ...orderMatch, orderDate: { $gte: thirtyDaysAgo }, status: { $ne: 'CANCELLED' } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalRev = salesStats.length > 0 ? salesStats[0].total : 0;
        const baseline = totalRev > 0 ? totalRev / 30 : 500;
        const predictions = [];
        for (let i = 1; i <= 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dow = date.getDay();
            const seasonality = (dow === 0 || dow === 6) ? 1.2 : 0.9;
            predictions.push({
                date: date.toISOString().split('T')[0],
                sales: Math.round(baseline * seasonality * (0.9 + Math.random() * 0.2))
            });
        }
        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
