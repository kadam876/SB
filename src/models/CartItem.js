const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    userId: { type: String, index: true },
    productId: String,
    name: String,
    imageUrl: String,
    price: Number,
    wholesalePrice: Number,
    originalPrice: Number,
    quantity: Number,
    selectedSize: String,
    wholesale: Boolean,
    piecesPerSet: Number,
    addedAt: { type: Date, default: Date.now }
}, { collection: 'cart_items' });

cartItemSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        // Crucial logic: ensure isWholesale corresponds to the wholesale boolean
        returnedObject.isWholesale = returnedObject.wholesale;
        delete returnedObject._id;
        delete returnedObject.__v;
    }
});

module.exports = mongoose.model('CartItem', cartItemSchema);
