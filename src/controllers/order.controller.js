const Order   = require('../models/Order');
const Product  = require('../models/Product');
const User     = require('../models/User');
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
 * Fetch payments for a Cashfree order.
 * Returns array of payment objects — each has cf_payment_id, payment_status, etc.
 */
const cfGetPayments = async (cfOrderId) => {
    const res = await axios.get(`${CF_BASE_URL}/orders/${cfOrderId}/payments`, { headers: cfHeaders() });
    return res.data; // array
};

/**
 * Initiate a PG refund for a successful payment.
 * refundId must be unique per order (we use orderId + timestamp).
 * Docs: POST /pg/orders/{order_id}/refunds
 */
const cfCreateRefund = async (cfOrderId, refundId, refundAmount, refundNote = 'Refund') => {
    const res = await axios.post(
        `${CF_BASE_URL}/orders/${cfOrderId}/refunds`,
        { refund_id: refundId, refund_amount: Number(refundAmount.toFixed(2)), refund_note: refundNote },
        { headers: cfHeaders() },
    );
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
            customerName,          // sent by frontend from logged-in user object
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

            // Fetch real user details for Cashfree customer info.
            // Cashfree requires a valid phone number for production payments.
            const dbUser = await User.findById(req.user.id).select('name email phone').lean();
            const custPhone = dbUser?.phone?.replace(/\D/g, '') || customerPhone || null;
            if (!custPhone) {
                return res.status(400).json({
                    error: 'A phone number is required for online payment. Please update your profile with a valid phone number.',
                });
            }

            const cfOrderId = makeCfOrderId();

            const cfData = await cfCreateOrder({
                order_id:       cfOrderId,
                order_amount:   Number(finalTotal.toFixed(2)),
                order_currency: 'INR',
                customer_details: {
                    customer_id:    req.user.id,
                    customer_phone: custPhone,
                    customer_email: dbUser?.email || customerEmail || '',
                    customer_name:  dbUser?.name  || customerName  || 'Customer',
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
        const dbUser   = await User.findById(req.user.id).select('name email phone').lean();
        const custPhone = dbUser?.phone?.replace(/\D/g, '') || null;
        if (!custPhone) {
            return res.status(400).json({
                error: 'A phone number is required for online payment. Please update your profile.',
            });
        }

        const cfOrderId = makeCfOrderId();

        const cfData = await cfCreateOrder({
            order_id:       cfOrderId,
            order_amount:   Number(order.totalAmount.toFixed(2)),
            order_currency: 'INR',
            customer_details: {
                customer_id:    req.user.id,
                customer_phone: custPhone,
                customer_email: dbUser?.email || '',
                customer_name:  dbUser?.name  || 'Customer',
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
            // Fetch actual payments to get the real cf_payment_id (needed for refunds).
            // cfOrder only has cf_order_id; the payment ID is on the payments list.
            let realPaymentId = cfOrder.cf_order_id; // fallback
            try {
                const payments = await cfGetPayments(cashfreeOrderId);
                const paid = Array.isArray(payments)
                    ? payments.find(p => p.payment_status === 'SUCCESS')
                    : null;
                if (paid?.cf_payment_id) realPaymentId = String(paid.cf_payment_id);
            } catch (_) { /* non-fatal — fallback used */ }

            const order = await Order.findOneAndUpdate(
                { cashfreeOrderId },
                { status: 'PAID', cashfreePaymentId: realPaymentId },
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
            const cfOrderId   = event?.data?.order?.order_id;
            const cfPaymentId = String(event?.data?.payment?.cf_payment_id || '');
            if (cfOrderId) {
                await Order.findOneAndUpdate(
                    { cashfreeOrderId: cfOrderId },
                    { status: 'PAID', cashfreePaymentId: cfPaymentId },
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

        // ── Refund webhook events ────────────────────────────────────────────
        if (type === 'REFUND_STATUS_WEBHOOK') {
            const cfOrderId    = event?.data?.order?.order_id;
            const refundStatus = event?.data?.refund?.refund_status; // SUCCESS | CANCELLED | ONHOLD
            const refundId     = event?.data?.refund?.refund_id;
            if (cfOrderId) {
                const updateFields = { refundStatus };
                if (refundStatus === 'SUCCESS') {
                    updateFields.status      = 'REFUNDED';
                    updateFields.refundedAt  = new Date();
                }
                await Order.findOneAndUpdate({ cashfreeOrderId: cfOrderId }, updateFields);
                console.log(`Refund webhook [${refundId}]: ${refundStatus} for order ${cfOrderId}`);
            }
        }

        res.status(200).send('OK');

    } catch (err) {
        console.error('Cashfree webhook error:', err.message);
        res.status(400).send('Webhook processing failed');
    }
};

// ── initiateRefund (admin only) ───────────────────────────────────────────────
/**
 * POST /api/orders/refund
 * Body: { orderId, refundAmount? }   — orderId is your MongoDB _id
 *
 * Calls Cashfree PG Refunds API. The refund_id we send is stable:
 *   RF_{mongoOrderId}   so duplicate calls return the existing refund, not an error.
 */
exports.initiateRefund = async (req, res) => {
    try {
        const { orderId, refundAmount } = req.body;
        if (!orderId) return res.status(400).json({ error: 'orderId is required.' });

        const order = await Order.findById(orderId);
        if (!order)            return res.status(404).json({ error: 'Order not found.' });
        if (order.status !== 'PAID')
            return res.status(400).json({ error: `Cannot refund an order with status "${order.status}".` });
        if (!order.cashfreeOrderId)
            return res.status(400).json({ error: 'No Cashfree order ID linked to this order.' });

        const amount     = refundAmount ? Number(refundAmount) : order.totalAmount;
        const refundId   = `RF_${order._id}`;

        // Call Cashfree PG Refunds API
        const cfRefund = await cfCreateRefund(
            order.cashfreeOrderId,
            refundId,
            amount,
            'Refund initiated by admin',
        );

        // Persist refund metadata immediately (webhook will update final status)
        order.refundId     = refundId;
        order.refundAmount = amount;
        order.refundStatus = cfRefund.refund_status || 'PENDING';
        if (cfRefund.refund_status === 'SUCCESS') {
            order.status     = 'REFUNDED';
            order.refundedAt = new Date();
        } else {
            order.status = 'REFUND_INITIATED';
        }
        await order.save();

        console.log(`Refund initiated [${refundId}]: status=${order.refundStatus}, amount=${amount}`);
        res.json({ success: true, refundId, refundStatus: order.refundStatus, order: order.toJSON() });

    } catch (err) {
        const detail = err.response?.data || err.message;
        console.error('initiateRefund error:', detail);
        // Surface the exact Cashfree error message so you can see what went wrong
        res.status(500).json({
            error:   detail?.message || err.message,
            cfError: detail,          // full Cashfree error body for debugging
        });
    }
};
