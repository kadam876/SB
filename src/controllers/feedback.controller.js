const Feedback = require('../models/Feedback');

exports.submitFeedback = async (req, res) => {
    try {
        const newFeedback = new Feedback({
            ...req.body,
            userId: req.user.id,
            userName: req.user.name || 'Anonymous' // Fallback
        });
        await newFeedback.save();
        res.status(201).json(newFeedback.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getProductFeedback = async (req, res) => {
    try {
        const feedbacks = await Feedback.find({ productId: req.params.productId }).sort({ createdAt: -1 });
        res.json(feedbacks.map(f => f.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getMyProductFeedback = async (req, res) => {
    try {
        const feedback = await Feedback.findOne({ 
            productId: req.params.productId,
            userId: req.user.id 
        });
        res.json(feedback ? feedback.toJSON() : null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
