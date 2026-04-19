const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

const checkUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const users = await User.find({}, 'name email role');
    console.log('Registered Users:');
    console.log(users);
    mongoose.connection.close();
  } catch (err) {
    console.error(err);
  }
};

checkUsers();
