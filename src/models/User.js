const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    shopName: { type: String },
    gstNumber: { type: String },
    phone: { type: String },
    role: { type: String, index: true },
    adminId: { type: String, index: true },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isProfileComplete: { type: Boolean, default: false },
    shopId: { type: String },
    address: { type: String }
}, { collection: 'users' });

// Align with Spring Boot's implicit output conventions if needed
userSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.__v;
        // Do not expose password
        delete returnedObject.password;
    }
});

module.exports = mongoose.model('User', userSchema);
