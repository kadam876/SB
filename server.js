// Deployment Pulse: v1.0.1
require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
}));

// Route Mapping
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tryon', tryonRoutes);
app.use('/api/feedback', feedbackRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', message: 'Node.js Express Backend is active - v1.0.3-Diagnostic-Active' });
});

// Database and Server Init
const PORT = process.env.PORT || 8080;

// Initialize Database
connectDB();

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
