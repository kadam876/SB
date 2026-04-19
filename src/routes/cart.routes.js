const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', cartController.getCart);
router.post('/', cartController.addToCart);
router.post('/merge', cartController.mergeLocalCart);
router.delete('/clear', cartController.clearCart);
router.put('/:id/quantity', cartController.updateQuantity);
router.delete('/:id', cartController.removeFromCart);

module.exports = router;
