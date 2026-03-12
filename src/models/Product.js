import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    // Name is the primary identifier usually, but we keep it flexible
    name: {
        type: String,
        required: true,
        index: true
    },
    // Dynamic fields stored as a Map
    // Example: { "price": 50000, "stock": 10, "color": "Red" }
    data: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

export default mongoose.model('Product', productSchema);
