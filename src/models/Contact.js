import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  tags: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound index to ensure unique phone per user if needed
contactSchema.index({ userId: 1, phone: 1 }, { unique: true });

const Contact = mongoose.model('Contact', contactSchema);
export default Contact;
