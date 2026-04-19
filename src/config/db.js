const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            console.error("❌ CRITICAL: MONGO_URI is not set in environment variables!");
            return;
        }

        // Avoid creating multiple connections in serverless environments
        if (mongoose.connection.readyState >= 1) return;

        await mongoose.connect(process.env.MONGO_URI, {
            family: 4 // Force IPv4
        });
        
        const host = process.env.MONGO_URI.includes('@') 
            ? process.env.MONGO_URI.split('@')[1].split('/')[0] 
            : 'local/unknown';
        console.log('MongoDB connected to:', host);
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        // Do not process.exit(1) on Vercel, it kills the Lambda immediately
        if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
            process.exit(1);
        }
    }
};

module.exports = connectDB;
