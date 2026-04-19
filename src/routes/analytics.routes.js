const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const authMiddleware = require('../middleware/auth');

// Apply authMiddleware to all analytics routes
router.use(authMiddleware);

router.get('/dashboard', analyticsController.getDashboardStats);
router.get('/dashboard-full', analyticsController.getFullDashboard);
router.get('/sales', analyticsController.getSalesData);
router.get('/categories', analyticsController.getCategoryDistribution);
router.get('/order-status', analyticsController.getOrderStatusDistribution);
router.get('/top-products', analyticsController.getTopSellingProducts);
router.get('/predictions', analyticsController.getSalesPredictions);
router.get('/growth', analyticsController.getGrowthData);

module.exports = router;

