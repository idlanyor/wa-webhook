import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        required: true,
        unique: true
    },
    customerJid: {
        type: String,
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    price: {
        type: String,
        required: true
    },
    details: {
        type: Map,
        of: String
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'cancelled', 'completed'],
        default: 'pending'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

export default mongoose.model('Order', orderSchema);
