const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    productId: { type: String, index: true },
    userId: { type: String, index: true },
    userName: String,
    rating: Number,
    comment: String,
    createdAt: { type: Date, default: Date.now }
}, { collection: 'feedbacks' });

feedbackSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.__v;
    }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
