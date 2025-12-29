import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  chatJid: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    required: true
  },
  senderJid: {
    type: String
  },
  message: {
    type: String
  },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true
  },
  timestamp: {
    type: Date,
    required: true
  },
  stanzaId: {
    type: String
  },
  rawMessage: {
    type: mongoose.Schema.Types.Mixed
  },
  replyToId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  quotedText: {
    type: String
  },
  quotedSender: {
    type: String
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

messageSchema.index({ userId: 1, chatJid: 1 });
messageSchema.index({ userId: 1, timestamp: -1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;
