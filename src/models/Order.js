const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    productId: String,
    productName: String,
    productImage: String,
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number,
    selectedSize: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
    userId: { type: String, index: true },
    adminId: { type: String, index: true },
    items: [orderItemSchema],
    subtotal: Number,
    gstAmount: Number,
    platformCharge: Number,
    totalAmount: Number,
    shippingAddress: String,
    paymentMethod: String,
    orderDate: { type: Date, default: Date.now, index: true },
    status: { type: String, index: true },
    trackingNumber: String,
    orderType: String,
    seeded: { type: Boolean, default: false },
    cashfreeOrderId: String,
    cashfreePaymentId: String
}, { collection: 'orders' });

orderSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.__v;
    }
});

module.exports = mongoose.model('Order', orderSchema);
