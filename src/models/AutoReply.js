import mongoose from 'mongoose';

const autoReplySchema = new mongoose.Schema({
  keyword: {
    type: String,
    required: true
  },
  reply: {
    type: String,
    required: true
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const AutoReply = mongoose.model('AutoReply', autoReplySchema);
export default AutoReply;
