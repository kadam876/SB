const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');

router.get('/', productController.getAllProducts);
router.get('/category/:category', productController.getProductsByCategory);
router.get('/catalogue/:id', productController.getProductsByCatalogue);
router.get('/categories', productController.getCategories);
router.get('/:id', productController.getProduct);

module.exports = router;
