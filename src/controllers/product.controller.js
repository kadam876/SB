const Product = require('../models/Product');
const Catalogue = require('../models/Catalogue');

exports.getAllProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const limit = parseInt(req.query.size) || 12;
        const skip = page * limit;

        const totalElements = await Product.countDocuments({ isActive: true });
        const products = await Product.find({ isActive: true })
            .skip(skip)
            .limit(limit);

        res.json({
            content: products.map(p => p.toJSON()),
            totalPages: Math.ceil(totalElements / limit),
            totalElements,
            number: page,
            size: limit
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getProductsByCategory = async (req, res) => {
    try {
        const products = await Product.find({ category: req.params.category, isActive: true });
        res.json(products.map(p => p.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getProductsByCatalogue = async (req, res) => {
    try {
        const products = await Product.find({ catalogueId: req.params.id, isActive: true });
        res.json(products.map(p => p.toJSON()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Not found' });
        res.json(product.toJSON());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await Product.distinct('category', { isActive: true });
        res.json({ categories });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
