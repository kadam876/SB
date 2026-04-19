const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    category: { type: String, index: true },
    price: Number,
    wholesalePrice: Number,
    stockQuantity: Number,
    imageUrl: String,
    sizes: [String],
    ratings: Number,
    badge: String,
    badgeColor: String,
    adminId: { type: String, index: true },
    catalogueId: { type: String, index: true },
    isActive: { type: Boolean, default: true, index: true },
    seeded: { type: Boolean, default: false }
}, { collection: 'products' });

productSchema.index({ isActive: 1, category: 1 });
productSchema.index({ adminId: 1, isActive: 1 });
productSchema.index({ catalogueId: 1, isActive: 1 });

productSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.__v;
    }
});

module.exports = mongoose.model('Product', productSchema);
