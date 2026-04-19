const Order   = require('../models/Order');
const Product  = require('../models/Product');
const axios    = require('axios');
const crypto   = require('crypto');

// ── Cashfree REST helpers ────────────────────────────────────────────────────
// Instead of using the cashfree-pg SDK (which has ESM/CJS compatibility issues)
// we call the Cashfree REST API directly with axios. The API is simple and stable.

const CF_BASE_URL =
    process.env.CASHFREE_ENV === 'PRODUCTION'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';

const CF_API_VERSION = '2023-08-01';

const cfHeaders = () => ({
    'x-client-id':     process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version':   CF_API_VERSION,
    'Content-Type':    'application/json',
});

/** Create a Cashfree payment order. Returns { payment_session_id, cf_order_id }. */
const cfCreateOrder = async (payload) => {
    const res = await axios.post(`${CF_BASE_URL}/orders`, payload, { headers: cfHeaders() });
    return res.data;
};

/** Fetch the status of a Cashfree order. Returns the order object (includes order_status). */
const cfFetchOrder = async (cfOrderId) => {
    const res = await axios.get(`${CF_BASE_URL}/orders/${cfOrderId}`, { headers: cfHeaders() });
    return res.data;
};

/**
 * Verify a Cashfree webhook signature.
 * Cashfree signs: HMAC-SHA256(timestamp + "." + rawBody, secret) → Base64.
 */
const cfVerifyWebhook = (rawBody, signature, timestamp) => {
    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = crypto
        .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
        .update(signedPayload)
        .digest('base64');
    return expected === signature;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const makeCfOrderId = () =>
    `SF_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

console.log(`✅ Cashfree REST client ready (${process.env.CASHFREE_ENV || 'SANDBOX'}) → ${CF_BASE_URL}`);

// ── createOrder ───────────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
    try {
        const {
            items,
            orderType,
            shippingAddress,
            paymentMethod,
            subtotal,
            gstAmount,
            platformCharge,
            totalAmount,
            customerPhone,
            customerEmail,
        } = req.body;

        // Resolve adminId from the first product in the order
        let adminId = null;
        if (items?.length > 0) {
            const product = await Product.findById(items[0].productId).select('adminId').lean();
            if (product) adminId = product.adminId;
        }

        // Compute item totals
        let computedTotal = 0;
        const processedItems = items.map(item => {
            const unitPrice = item.unitPrice  || 0;
            const quantity  = item.quantity   || 1;
            const itemTotal = item.totalPrice || (unitPrice * quantity);
            computedTotal  += itemTotal;
            return { ...item, unitPrice, totalPrice: itemTotal, quantity };
        });

        const finalTotal = totalAmount || computedTotal;

        const newOrder = new Order({
            userId:         req.user.id,
            adminId,
            items:          processedItems,
            subtotal:       subtotal        || computedTotal,
            gstAmount:      gstAmount       || 0,
            platformCharge: platformCharge  || 0,
            totalAmount:    finalTotal,
            shippingAddress,
            paymentMethod,
            orderType:      orderType       || 'RETAIL',
            status:         'PENDING_CONFIRMATION',
        });

        // ── Cashfree online payment ──────────────────────────────────────────
        if (paymentMethod === 'CASHFREE') {
            if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
                return res.status(400).json({
                    error: 'Online payment is currently unavailable. Please use Cash on Delivery.',
                });
            }

            const cfOrderId = makeCfOrderId();

            const cfData = await cfCreateOrder({
                order_id:       cfOrderId,
                order_amount:   Number(finalTotal.toFixed(2)),
                order_currency: 'INR',
                customer_details: {
                    customer_id:    req.user.id,
                    customer_phone: customerPhone || '9999999999',
                    customer_email: customerEmail || '',
                    customer_name:  req.user.name || 'Customer',
                },
                order_meta: {
                    return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/my-orders?order_id={order_id}`,
                    notify_url: `${process.env.BACKEND_URL  || 'http://localhost:8080'}/api/orders/webhook/cashfree`,
                },
            });

            newOrder.cashfreeOrderId = cfData.cf_order_id || cfOrderId;
            await newOrder.save();

            return res.status(201).json({
                ...newOrder.toJSON(),
                paymentSessionId: cfData.payment_session_id,
                cashfreeOrderId:  cfData.cf_order_id || cfOrderId,
            });
        }

        // ── COD / any other method ───────────────────────────────────────────
        await newOrder.save();
        res.status(201).json(newOrder.toJSON());

    } catch (err) {
        const detail = err.response?.data || err.message;
        console.error('createOrder error:', detail);
        res.status(500).json({ error: detail?.message || detail || err.message });
    }
};

// ── getMyOrders ───────────────────────────────────────────────────────────────
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ orderDate: -1 });
        res.json(orders.map(o => o.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── retrySession ──────────────────────────────────────────────────────────────
exports.retrySession = async (req, res) => {
    try {
        const { cashfreeOrderId } = req.body;
        if (!cashfreeOrderId) return res.status(400).json({ error: 'cashfreeOrderId is required.' });

        const order = await Order.findOne({ cashfreeOrderId, userId: req.user.id });
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        if (order.status === 'PAID') return res.status(400).json({ error: 'Order is already paid.' });

        // Create a new Cashfree order_id to avoid reusing a stuck/expired session.
        const cfOrderId = makeCfOrderId();

        const cfData = await cfCreateOrder({
            order_id:       cfOrderId,
            order_amount:   Number(order.totalAmount.toFixed(2)),
            order_currency: 'INR',
            customer_details: {
                customer_id:    req.user.id,
                customer_phone: '9999999999',
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/my-orders?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL  || 'http://localhost:8080'}/api/orders/webhook/cashfree`,
            },
        });

        // Update the DB so verify/webhook can find it by the new ID.
        order.cashfreeOrderId = cfOrderId;
        await order.save();

        res.json({ paymentSessionId: cfData.payment_session_id, cashfreeOrderId: cfOrderId });

    } catch (err) {
        const detail = err.response?.data || err.message;
        console.error('retrySession error:', detail);
        res.status(500).json({ error: detail?.message || detail || err.message });
    }
};

// ── verifyPayment ─────────────────────────────────────────────────────────────
exports.verifyPayment = async (req, res) => {
    try {
        if (!process.env.CASHFREE_APP_ID) {
            return res.status(500).json({ error: 'Cashfree configuration missing on server.' });
        }

        const { cashfreeOrderId } = req.body;
        if (!cashfreeOrderId) return res.status(400).json({ error: 'cashfreeOrderId is required.' });

        // Always verify server-side — never trust the client.
        const cfOrder     = await cfFetchOrder(cashfreeOrderId);
        const orderStatus = cfOrder?.order_status; // 'PAID' | 'ACTIVE' | 'EXPIRED' …

        if (orderStatus === 'PAID') {
            const order = await Order.findOneAndUpdate(
                { cashfreeOrderId },
                { status: 'PAID', cashfreePaymentId: cfOrder.cf_order_id },
                { new: true },
            );
            if (!order) return res.status(404).json({ error: 'Order not found' });
            return res.status(200).json({ success: true, order: order.toJSON() });
        }

        res.status(402).json({
            success: false,
            error:   `Payment not completed. Status: ${orderStatus}`,
            orderStatus,
        });

    } catch (err) {
        const detail = err.response?.data || err.message;
        console.error('verifyPayment error:', detail);
        res.status(500).json({ error: detail?.message || detail || err.message });
    }
};

// ── cashfreeWebhook ───────────────────────────────────────────────────────────
exports.cashfreeWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const rawBody   = req.rawBody;

        if (!signature || !timestamp || !rawBody) {
            return res.status(400).send('Missing webhook headers');
        }

        if (!cfVerifyWebhook(rawBody, signature, timestamp)) {
            return res.status(400).send('Invalid signature');
        }

        const event = JSON.parse(rawBody);
        const type  = event?.type;

        if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
            const cfOrderId = event?.data?.order?.order_id;
            if (cfOrderId) {
                await Order.findOneAndUpdate(
                    { cashfreeOrderId: cfOrderId },
                    { status: 'PAID', cashfreePaymentId: event?.data?.payment?.cf_payment_id },
                );
            }
        }

        if (type === 'PAYMENT_FAILED_WEBHOOK') {
            const cfOrderId = event?.data?.order?.order_id;
            if (cfOrderId) {
                await Order.findOneAndUpdate(
                    { cashfreeOrderId: cfOrderId },
                    { status: 'PAYMENT_FAILED' },
                );
            }
        }

        res.status(200).send('OK');

    } catch (err) {
        console.error('Cashfree webhook error:', err.message);
        res.status(400).send('Webhook processing failed');
    }
};
