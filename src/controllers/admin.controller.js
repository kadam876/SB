const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { createClient } = require('@supabase/supabase-js');

// Only instantiate client if keys are present (prevents server crash before you configure .env)
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

const uploadImageToSupabase = async (base64String) => {
    if (!base64String.startsWith('data:image/')) return base64String;

    const matches = base64String.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) throw new Error('Invalid base64 string provided');

    let mimeType = matches[1];
    let buffer = Buffer.from(matches[2], 'base64');

    // Convert unsupported formats (AVIF, WEBP, etc.) to JPEG for universal compatibility
    const SUPPORTED = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!SUPPORTED.includes(mimeType)) {
        try {
            const sharp = require('sharp');
            console.log(`[Upload] Converting ${mimeType} → image/jpeg`);
            buffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
            mimeType = 'image/jpeg';
        } catch (sharpErr) {
            console.warn(`[Upload] Skipping conversion, sharp not available natively on this OS:`, sharpErr.message);
        }
    }

    const extension = mimeType.split('/')[1] || 'jpg';
    const fileName = `products/${Date.now()}-${Math.floor(Math.random() * 10000)}.${extension}`;
    const bucket = process.env.SUPABASE_BUCKET || 'sandhya-images';

    const { error } = await supabase.storage.from(bucket).upload(fileName, buffer, {
        contentType: mimeType,
        upsert: false
    });

    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return publicUrlData.publicUrl;
};

exports.getDashboard = async (req, res) => {
    res.json({ message: "Admin dashboard mapped" });
};

exports.addProduct = async (req, res) => {
    try {
        // Map 'active' (from frontend) to 'isActive' (mongodb schema)
        const isActive = req.body.active !== undefined ? req.body.active : (req.body.isActive !== undefined ? req.body.isActive : true);
        let payload = { ...req.body, adminId: req.user.id, isActive };
        
        if (payload.imageUrl && payload.imageUrl.startsWith('data:image/')) {
            payload.imageUrl = await uploadImageToSupabase(payload.imageUrl);
        }

        const product = new Product(payload);
        await product.save();
        res.status(201).json(product.toJSON());
    } catch (err) {
        console.error("ADMIN ADD PRODUCT CRASH:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getInventory = async (req, res) => {
    try {
        const products = await Product.find({ adminId: req.user.id });
        const inventory = products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            category: p.category,
            price: p.price,
            stockQuantity: p.stockQuantity,
            imageUrl: p.imageUrl,
            isActive: p.isActive
        }));
        res.json(inventory);
    } catch (err) {
        console.error("ADMIN INVENTORY FETCH CRASH:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getAdminInfo = async (req, res) => {
    res.json({
        message: "Welcome to Admin Panel",
        adminName: req.user.name || "Admin User",
        permissions: ["MANAGE_PRODUCTS", "MANAGE_ORDERS", "VIEW_ANALYTICS", "MANAGE_USERS"],
        dashboard: "/api/admin/dashboard",
        inventory: "/api/admin/inventory",
        orders: "/api/admin/orders",
        users: "/api/admin/my-users"
    });
};

exports.getMyUsers = async (req, res) => {
    try {
        // Find all users with the CUSTOMER role
        // Removed sort by createdAt as it is not in the schema
        const customers = await User.find({ 
            role: { $in: ['CUSTOMER', 'customer'] } 
        });

        // Enrich with order counts
        const enrichedCustomers = await Promise.all(customers.map(async (customer) => {
            const orderCount = await Order.countDocuments({ userId: customer._id.toString() });
            const customerObj = customer.toJSON();
            return {
                ...customerObj,
                orderCount
            };
        }));

        res.json(enrichedCustomers);
    } catch (err) {
        console.error("GET MY USERS ERROR:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getCatalogues = async (req, res) => {
    res.json([]); // Simple stub to prevent 404
};

exports.updateProduct = async (req, res) => {
    try {
        // Map 'active' (from frontend) to 'isActive' (mongodb schema)
        const updates = { ...req.body };
        if (updates.active !== undefined) {
            updates.isActive = updates.active;
        }

        if (updates.imageUrl && updates.imageUrl.startsWith('data:image/')) {
            updates.imageUrl = await uploadImageToSupabase(updates.imageUrl);
        }

        const product = await Product.findOneAndUpdate(
            { _id: req.params.id, adminId: req.user.id },
            updates,
            { new: true }
        );
        if (!product) return res.status(404).json({ error: 'Product not found or unauthorized' });
        res.json(product.toJSON());
    } catch (err) {
        console.error("ADMIN UPDATE PRODUCT CRASH:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        await Product.findOneAndDelete({ _id: req.params.id, adminId: req.query.adminId });
        res.sendStatus(204);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getOrders = async (req, res) => {
    try {
        const adminId = req.user.id;
        const orders = await Order.find({ adminId }).sort({ orderDate: -1 });
        res.json(orders.map(o => o.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getOrdersByStatus = async (req, res) => {
    try {
        const { status } = req.params;
        // In single shop mode, we return all orders of this status
        const orders = await Order.find({ status }).sort({ orderDate: -1 });
        res.json(orders.map(o => o.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { status: req.query.status || req.body.status },
            { new: true }
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.json(order.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- Platform Stats (Simplified for single shop) ---

exports.getPlatformStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ role: { $in: ['CUSTOMER', 'customer'] } });
        const totalOrders = await Order.countDocuments({});
        const totalProducts = await Product.countDocuments({ isActive: true });

        const revenueResult = await Order.aggregate([
            { $match: { status: { $in: ['PAID', 'DELIVERED', 'SHIPPED'] } } },
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

        res.json({
            totalShops: 1, // Always 1 in single shop mode
            totalUsers,
            totalOrders,
            totalRevenue,
            totalProducts,
            platformGrowth: 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.debugDb = async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const pCount = await Product.countDocuments();
        const oCount = await Order.countDocuments();
        const uCount = await User.countDocuments();
        
        const uri = process.env.MONGO_URI || '';
        const host = uri.includes('@') ? uri.split('@')[1].split('/')[0] : 'not set/local';

        res.json({
            success: true,
            database: {
                host,
                readyState: mongoose.connection.readyState,
                counts: {
                    products: pCount,
                    orders: oCount,
                    users: uCount
                }
            },
            serverTime: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

