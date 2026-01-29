import mongoose from 'mongoose';

const supportContentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['help_center', 'terms_of_service', 'privacy_policy', 'faq', 'about_us'],
    required: true
  },
  targetRole: {
    type: String,
    enum: ['all', 'teacher', 'student'],
    default: 'all'
  },
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileType: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  sections: [{
    title: String,
    content: String,
    order: Number
  }],
  contactInfo: {
    email: String,
    phone: String,
    address: String,
    whatsapp: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Compound unique index: same type + same targetRole must be unique
supportContentSchema.index({ type: 1, targetRole: 1 }, { unique: true });

const SupportContent = mongoose.model('SupportContent', supportContentSchema);

export { SupportContent };
