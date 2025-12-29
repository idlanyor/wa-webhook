import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  keyHash: {
    type: String,
    required: true,
    unique: true
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
export default ApiKey;
