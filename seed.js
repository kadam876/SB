require('dotenv').config();
const mongoose = require('mongoose');
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Product = require('./src/models/Product');
const Order = require('./src/models/Order');

const ADMIN_EMAIL    = 'owner@sandhya.com';
const ADMIN_PASSWORD = 'OwnerPassword123!';

const SIZES = ['S', 'M', 'L', 'XL'];

// Your actual products — no images
const PRODUCT_TEMPLATES = [
  { name: 'Beautiful Cotton Midi',        category: 'Midi',        price: 375, stock: 28 },
  { name: 'Beautiful Cotton Midi',        category: 'Midi',        price: 375, stock: 11 },
  { name: 'Beautiful Embroidery Cordset', category: 'Cord Set',    price: 535, stock: 25 },
  { name: 'Aline prince cut 2pc Set',     category: '2 Piece',     price: 525, stock: 4  },
  { name: 'Beautiful Cotton 3pc Set',     category: '3 Piece',     price: 599, stock: 25 },
  { name: 'Heavy Dhabu Cotton Tunic',     category: 'Short Tunic', price: 295, stock: 24 },
  { name: 'Beautiful 2pc Set',            category: '2 Piece',     price: 495, stock: 12 },
];

const randomDate = (daysBack) => {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  d.setHours(Math.floor(Math.random() * 12) + 8);
  return d;
};

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'DELIVERED', 'DELIVERED'];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    console.log('✅ Connected to MongoDB:', mongoose.connection.host);

    // 1. Find or create admin
    let admin = await User.findOne({ email: ADMIN_EMAIL });
    if (!admin) {
      admin = new User({
        name: 'Sandhya Fashion Owner',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        role: 'OWNER',
        shopName: 'Sandhya Fashion',
        isVerified: true,
        isActive: true,
        isProfileComplete: true,
        phone: '+917573943992',
        address: 'Shop No- B/5083, Upper Ground Floor, Global Textile Market Surat 395010'
      });
      await admin.save();
      console.log(`✅ Admin created: ${ADMIN_EMAIL}`);
    } else {
      admin.password = ADMIN_PASSWORD;
      await admin.save();
      console.log(`✅ Found and updated admin: ${ADMIN_EMAIL} (id: ${admin._id})`);
    }

    const adminId = admin._id.toString();

    // 2. Clear previous seed data
    const deletedProducts = await Product.deleteMany({ adminId, seeded: true });
    const deletedOrders   = await Order.deleteMany({ adminId, seeded: true });
    console.log(`🧹 Removed ${deletedProducts.deletedCount} old products, ${deletedOrders.deletedCount} old orders`);

    // 3. Create products (no imageUrl)
    const products = [];
    for (const tmpl of PRODUCT_TEMPLATES) {
      const wholesalePrice = Math.round(tmpl.price * 0.72); // ~28% margin
      const p = new Product({
        name: tmpl.name,
        category: tmpl.category,
        price: tmpl.price,
        wholesalePrice,
        mrpPrice: tmpl.price,
        stockQuantity: tmpl.stock,
        sizes: SIZES,
        ratings: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)),
        adminId,
        isActive: true,
        seeded: true,
        description: `Premium quality ${tmpl.name} from Sandhya Fashion. Available in all sizes.`
      });
      await p.save();
      products.push(p);
      console.log(`   + ${p.name} (₹${p.wholesalePrice}/pc, stock: ${p.stockQuantity})`);
    }
    console.log(`✅ Created ${products.length} products`);

    // 4. Sample customer
    let customer = await User.findOne({ email: 'customer@test.com' });
    if (!customer) {
      customer = new User({
        name: 'Test Customer',
        email: 'customer@test.com',
        password: 'customer123',
        role: 'CUSTOMER',
        isVerified: true,
        isActive: true,
        isProfileComplete: true,
        address: 'Mumbai, Maharashtra'
      });
      await customer.save();
      console.log('✅ Test customer created: customer@test.com / customer123');
    }
    const customerId = customer._id.toString();

    // 5. Generate 45 orders spread over last 60 days
    let totalRevenue = 0;
    for (let i = 0; i < 45; i++) {
      const itemCount = randomInt(1, 3);
      const usedIdx = new Set();
      const items = [];

      while (items.length < itemCount) {
        const idx = randomInt(0, products.length - 1);
        if (usedIdx.has(idx)) continue;
        usedIdx.add(idx);
        const p = products[idx];
        const qty = randomInt(1, 5);
        const sizesCount = 4;
        const unitPrice = p.wholesalePrice;
        const totalPrice = unitPrice * sizesCount * qty;
        items.push({
          productId: p._id.toString(),
          productName: p.name,
          productImage: '',
          quantity: qty,
          unitPrice,
          totalPrice,
          selectedSize: 'SET'
        });
      }

      const subtotal       = items.reduce((s, it) => s + it.totalPrice, 0);
      const gstAmount      = parseFloat((subtotal * 0.05).toFixed(2));
      const platformCharge = parseFloat((subtotal * 0.02).toFixed(2));
      const totalAmount    = parseFloat((subtotal + gstAmount + platformCharge).toFixed(2));
      totalRevenue += totalAmount;

      await new Order({
        userId: customerId,
        adminId,
        items,
        subtotal,
        gstAmount,
        platformCharge,
        totalAmount,
        shippingAddress: 'Shop No 12, Textile Market, Mumbai 400001',
        paymentMethod: 'COD',
        orderType: 'WHOLESALE',
        status: STATUSES[randomInt(0, STATUSES.length - 1)],
        orderDate: randomDate(60),
        seeded: true
      }).save();
    }

    console.log(`✅ Created 45 orders`);
    console.log(`\n📊 Seed complete!`);
    console.log(`   Admin login:    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`   Customer login: customer@test.com / customer123`);
    console.log(`   Total revenue seeded: ₹${totalRevenue.toFixed(2)}`);
    console.log(`\n🚀 Refresh the dashboard — all charts should now show data.`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
  }
}

seed();
