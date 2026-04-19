const mongoose = require('mongoose');

// Cache the connection promise so all requests in a cold-start await the same one
let _connectionPromise = null;

const connectDB = () => {
    if (!process.env.MONGO_URI) {
        console.error("❌ CRITICAL: MONGO_URI is not set in environment variables!");
        return Promise.reject(new Error('MONGO_URI not set'));
    }

    // Already connected — return immediately
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve();
    }

    // A connection is already in progress — reuse it
    if (_connectionPromise) {
        return _connectionPromise;
    }

    _connectionPromise = mongoose
        .connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            family: 4 // Force IPv4
        })
        .then(() => {
            const host = process.env.MONGO_URI.includes('@')
                ? process.env.MONGO_URI.split('@')[1].split('/')[0]
                : 'local/unknown';
            console.log('MongoDB connected to:', host);
        })
        .catch((err) => {
            console.error('MongoDB connection error:', err.message);
            _connectionPromise = null; // allow retry on next request
            if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
                process.exit(1);
            }
            throw err;
        });

    return _connectionPromise;
};

module.exports = connectDB;
