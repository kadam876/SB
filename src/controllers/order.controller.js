const Order = require('../models/Order');
const Product = require('../models/Product');
const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpay;
try {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }
} catch (err) {
    console.error('Razorpay initialization error:', err);
}

exports.createOrder = async (req, res) => {
    try {
        const { items, orderType, shippingAddress, paymentMethod, subtotal, gstAmount, platformCharge, totalAmount } = req.body;

        // Resolve adminId from the first product in the order
        let adminId = null;
        if (items && items.length > 0) {
            const firstProductId = items[0].productId;
            if (firstProductId) {
                const product = await Product.findById(firstProductId).select('adminId').lean();
                if (product) adminId = product.adminId;
            }
        }

        let computedTotal = 0;
        const processedItems = items.map(item => {
            const unitPrice = item.unitPrice || 0;
            const quantity = item.quantity || 1;
            const itemTotal = item.totalPrice || (unitPrice * quantity);
            computedTotal += itemTotal;
            return { ...item, unitPrice, totalPrice: itemTotal, quantity };
        });

        // Use the billing total from frontend (includes GST + platform charges) if provided
        const finalTotal = totalAmount || computedTotal;

        const newOrder = new Order({
            userId: req.user.id,
            adminId,
            items: processedItems,
            subtotal: subtotal || computedTotal,
            gstAmount: gstAmount || 0,
            platformCharge: platformCharge || 0,
            totalAmount: finalTotal,
            shippingAddress,
            paymentMethod,
            orderType: orderType || 'RETAIL',
            status: 'PENDING_CONFIRMATION'
        });

        if (paymentMethod === 'RAZORPAY') {
            if (!razorpay) {
                return res.status(400).json({ error: "Online payment is currently unavailable. Please use Cash on Delivery." });
            }
            const options = {
                amount: Math.round(finalTotal * 100), // amount in the smallest currency unit (paise)
                currency: "INR",
                receipt: `receipt_order_${new Date().getTime()}`,
            };

            const rzpOrder = await razorpay.orders.create(options);
            newOrder.razorpayOrderId = rzpOrder.id;
            await newOrder.save();
            
            return res.status(201).json({
                ...newOrder.toJSON(),
                razorpayOrderId: rzpOrder.id,
                amount: options.amount,
                keyId: process.env.RAZORPAY_KEY_ID
            });
        }

        await newOrder.save();
        res.status(201).json(newOrder.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ orderDate: -1 });
        res.json(orders.map(o => o.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        if (!process.env.RAZORPAY_KEY_SECRET) {
            return res.status(500).json({ error: "Razorpay configuration missing on server." });
        }
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature === razorpay_signature) {
            const order = await Order.findOneAndUpdate(
                { razorpayOrderId: razorpay_order_id },
                { status: 'PAID', razorpayPaymentId: razorpay_payment_id },
                { new: true }
            );

            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            res.status(200).json({ success: true, order });
        } else {
            res.status(400).json({ error: "Invalid signature" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
