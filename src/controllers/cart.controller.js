const CartItem = require('../models/CartItem');

exports.getCart = async (req, res) => {
    try {
        const items = await CartItem.find({ userId: req.user.id });
        res.json(items.map(item => item.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.addToCart = async (req, res) => {
    try {
        const { productId, selectedSize, wholesale } = req.body;
        // Search criteria mimics Java findByUserIdAndProductIdAndSelectedSizeAndWholesale
        const criteria = { userId: req.user.id, productId, wholesale: !!wholesale };
        if (!wholesale && selectedSize) {
            criteria.selectedSize = selectedSize;
        }

        let existingItem = await CartItem.findOne(criteria);
        
        if (existingItem) {
            existingItem.quantity += (req.body.quantity || 1);
            await existingItem.save();
        } else {
            const newItem = new CartItem({
                ...req.body,
                userId: req.user.id,
                wholesale: !!wholesale
            });
            await newItem.save();
        }

        const fullCart = await CartItem.find({ userId: req.user.id });
        res.json(fullCart.map(item => item.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.removeFromCart = async (req, res) => {
    try {
        await CartItem.deleteOne({ _id: req.params.id, userId: req.user.id });
        const items = await CartItem.find({ userId: req.user.id });
        res.json(items.map(item => item.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateQuantity = async (req, res) => {
    try {
        const quantity = parseInt(req.query.quantity);
        if (quantity > 0) {
            await CartItem.findOneAndUpdate(
                { _id: req.params.id, userId: req.user.id },
                { quantity }
            );
        }
        const items = await CartItem.find({ userId: req.user.id });
        res.json(items.map(item => item.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.clearCart = async (req, res) => {
    try {
        await CartItem.deleteMany({ userId: req.user.id });
        res.json({ message: 'Cart cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.mergeLocalCart = async (req, res) => {
    try {
        const localItems = req.body || [];
        for (const item of localItems) {
            const criteria = { userId: req.user.id, productId: item.productId, wholesale: !!item.wholesale };
            if (!item.wholesale && item.selectedSize) {
                criteria.selectedSize = item.selectedSize;
            }
            
            let existingItem = await CartItem.findOne(criteria);
            if (existingItem) {
                existingItem.quantity += (item.quantity || 1);
                await existingItem.save();
            } else {
                const newItem = new CartItem({
                    ...item,
                    userId: req.user.id,
                    wholesale: !!item.wholesale
                });
                delete newItem._id; // Ignore frontend fake ids
                await newItem.save();
            }
        }
        const items = await CartItem.find({ userId: req.user.id });
        res.json(items.map(item => item.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
