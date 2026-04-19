// Deployment Pulse: v1.0.5-Perf
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/auth.routes');
const productRoutes = require('./src/routes/product.routes');
const cartRoutes = require('./src/routes/cart.routes');
const orderRoutes = require('./src/routes/order.routes');
const analyticsRoutes = require('./src/routes/analytics.routes');
const tryonRoutes = require('./src/routes/tryon.routes');
const adminRoutes = require('./src/routes/admin.routes');
const feedbackRoutes = require('./src/routes/feedback.routes');

const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src":  ["'self'", "'unsafe-inline'", "https://sdk.cashfree.com", "https://*.cashfree.com"],
            "style-src":   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src":    ["'self'", "data:", "https://fonts.gstatic.com", "https://sandhya-b.vercel.app", "http://localhost:8080"],
            "img-src":     ["'self'", "data:", "blob:", "https://*.supabase.co", "https://*.cashfree.com"],
            "connect-src": ["'self'", "https://sandhya-b.vercel.app", "http://localhost:8080", "https://*.supabase.co", "https://*.cashfree.com"],
            "frame-src":   ["'self'", "https://*.cashfree.com"]
        },
    },
}));

// NOTE: rawBody capture is applied ONLY on the Cashfree webhook route (see order.routes.js)
// so that express.json() works normally for every other endpoint.
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
}));
// Gzip compression — cuts API response sizes by 60-80%
app.use(compression());

// Cache-Control: tell the browser to cache static-ish GET responses for 60s
// (short enough to be fresh, long enough to avoid redundant re-fetches on navigation)
app.use((req, res, next) => {
    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    } else {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});

// DB-Guard: Await the MongoDB connection on every request before any route handler runs.
// This is critical for Vercel serverless cold-starts where connectDB() hasn't finished
// by the time the first request arrives.
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('DB connection failed for request:', req.method, req.path, err.message);
        res.status(503).json({ error: 'Database unavailable. Please try again.' });
    }
});

// Route Mapping
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tryon', tryonRoutes);
app.use('/api/feedback', feedbackRoutes);

// Health Check & Root
app.get('/', (req, res) => {
    res.send('<h1>Sandhya Fashion Backend</h1><p>Status: Active</p>');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', message: 'Node.js Express Backend is active - v1.0.4-DB-Guard' });
});

// Database and Server Init
const PORT = process.env.PORT || 8080;

// Only start the server if not running as a Vercel serverless function
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`\n❌ CRITICAL ERROR: PORT ${PORT} IS ALREADY IN USE!`);
            console.error(`This means your Java (Spring Boot) backend is STILL RUNNING!`);
            console.error(`You MUST kill the Java terminal completely before Node can take over!\n`);
            process.exit(1);
        } else {
            console.error(e);
        }
    });
}

// Export the app for Vercel serverless functions
module.exports = app;
