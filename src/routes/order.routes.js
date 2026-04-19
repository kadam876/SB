const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const authMiddleware = require('../middleware/auth');

// Inline raw-body capture — Cashfree signature verification needs the exact raw bytes.
// Applied ONLY here so express.json() is unaffected on every other route.
const captureRawBody = (req, res, next) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { req.rawBody = data; next(); });
};

router.post('/webhook/cashfree', captureRawBody, orderController.cashfreeWebhook);

// ── Protected Order Routes ───────────────────────────────────────────────────
router.use(authMiddleware);

router.post('/',               orderController.createOrder);
router.post('/verify-payment', orderController.verifyPayment);
router.post('/retry-session',  orderController.retrySession);
router.post('/refund',         orderController.initiateRefund);   // admin: trigger a Cashfree PG refund
router.get('/my-orders',       orderController.getMyOrders);

module.exports = router;
