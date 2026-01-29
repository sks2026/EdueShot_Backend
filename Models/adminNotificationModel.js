import mongoose from 'mongoose';

const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['account_deletion', 'report', 'verification', 'withdrawal', 'other'],
      required: true
    },
    title: { type: String, required: true },
    message: { type: String, required: true },

    // User who triggered this notification
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // Additional data based on notification type
    data: {
      reason: { type: String }, // Deletion reason
      userRole: { type: String }, // student/teacher
      userEmail: { type: String },
      userName: { type: String },
      withdrawalId: { type: String }, // Withdrawal request ID
      withdrawalAmount: { type: Number }, // Withdrawal amount
      paymentMethod: { type: String } // Payment method for withdrawal
    },

    // Status tracking
    status: {
      type: String,
      enum: ['unread', 'read', 'actioned'],
      default: 'unread'
    },

    // Admin who handled this notification
    handledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    handledAt: { type: Date, default: null },

    // Action taken by admin
    actionTaken: {
      type: String,
      enum: ['none', 'approved', 'rejected'],
      default: 'none'
    },
    actionNote: { type: String, default: null } // Admin's note on action
  },
  { timestamps: true }
);

// Index for quick querying
adminNotificationSchema.index({ status: 1, createdAt: -1 });
adminNotificationSchema.index({ type: 1, status: 1 });

export default mongoose.model('AdminNotification', adminNotificationSchema);
