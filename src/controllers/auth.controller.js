const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Token Generator replicating Spring Security output
const generateToken = (user) => {
    return jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRATION + 'ms' }
    );
};

exports.register = async (req, res) => {
    try {
        // Force role to CUSTOMER for all public signups
        const role = 'CUSTOMER';
        const { name, email, password, phone } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        // No hashing - storing plain text as requested
        const newUser = new User({
            name, email, password, phone, role
        });
        await newUser.save();

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: newUser.toJSON()
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid credentials' });
        }

        const isMatch = (password === user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: 'Invalid credentials' });
        }

        res.json({
            success: true,
            token: generateToken(user),
            user: user.toJSON()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user: user.toJSON() });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const allowedFields = ['name', 'phone', 'address', 'shopName', 'gstNumber'];
        const updates = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updates,
            { new: true }
        );
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user: user.toJSON() });
    } catch (err) {
        console.error('UPDATE PROFILE ERROR:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.googleLogin = async (req, res) => {
    try {
        const { token, role } = req.body;
        if (!token) return res.status(400).json({ success: false, error: 'Token is required' });

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name } = payload;

        let user = await User.findOne({ email });
        
        if (!user) {
            // Register them automatically
            user = new User({
                name: name,
                email: email,
                role: 'CUSTOMER',
                isVerified: true
            });
            await user.save();
        }

        res.json({
            success: true,
            token: generateToken(user),
            user: user.toJSON()
        });
    } catch (err) {
        console.error('Google Auth Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};
