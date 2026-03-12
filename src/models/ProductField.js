import mongoose from 'mongoose';

const productFieldSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true, // e.g., 'price', 'stock', 'description'
        trim: true
    },
    label: {
        type: String,
        required: true // e.g., 'Harga', 'Stok Barang', 'Keterangan'
    },
    type: {
        type: String,
        enum: ['text', 'number', 'boolean', 'url'],
        default: 'text'
    },
    order: {
        type: Number,
        default: 0
    },
    isSystem: {
        type: Boolean,
        default: false // true if it's a default field like 'name'
    }
}, { timestamps: true });

export default mongoose.model('ProductField', productFieldSchema);
