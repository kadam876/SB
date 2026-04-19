const mongoose = require('mongoose');

const catalogueSchema = new mongoose.Schema({
    adminId: String,
    categoryName: String,
    imageUrl: String,
    sizes: [String]
}, { collection: 'catalogues' });

catalogueSchema.set('toJSON', {
    transform: (document, returnedObject) => {
        returnedObject.id = returnedObject._id.toString();
        delete returnedObject._id;
        delete returnedObject.__v;
    }
});

module.exports = mongoose.model('Catalogue', catalogueSchema);
