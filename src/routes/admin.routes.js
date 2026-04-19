const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const authMiddleware = require('../middleware/auth');
const authorize = require('../middleware/authorize');

router.use(authMiddleware);

router.get('/dashboard', adminController.getDashboard);
router.get('/inventory', adminController.getInventory);
router.get('/info', adminController.getAdminInfo);
router.get('/my-users', adminController.getMyUsers);
router.get('/catalogues', adminController.getCatalogues);
router.get('/orders', adminController.getOrders);
router.get('/orders/status/:status', adminController.getOrdersByStatus);
router.get('/debug-db', adminController.debugDb);

router.post('/products', adminController.addProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

router.put('/orders/:id/status', adminController.updateOrderStatus);

// Defunct platform-owner routes were removed here as this is now a single-shop application.

module.exports = router;
