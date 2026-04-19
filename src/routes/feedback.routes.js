const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedback.controller');
const authMiddleware = require('../middleware/auth');

router.get('/product/:productId', feedbackController.getProductFeedback);
router.post('/', authMiddleware, feedbackController.submitFeedback);

module.exports = router;
