import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    // Recipient of the notification
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    recipientRole: {
      type: String,
      enum: ['teacher', 'student', 'admin'],
      required: true
    },

    // Notification type
    type: {
      type: String,
      enum: [
        'course_purchase',      // Student purchased course
        'course_enrollment',    // Student enrolled in free course
        'new_review',           // Student reviewed course
        'quiz_completed',       // Student completed quiz
        'new_follower',         // Someone followed
        'video_like',           // Someone liked video
        'comment',              // New comment
        'system',               // System notification
        'other'
      ],
      required: true
    },

    // Notification content
    title: { type: String, required: true },
    message: { type: String, required: true },

    // Related entities
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    relatedCourse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course'
    },
    relatedVideo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video'
    },
    relatedQuiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz'
    },

    // Additional data
    data: {
      amount: { type: Number },           // Purchase amount
      courseName: { type: String },       // Course name
      studentName: { type: String },      // Student name
      studentEmail: { type: String }      // Student email
    },

    // Status
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },

    // For grouping similar notifications
    groupKey: { type: String, default: null }
  },
  { timestamps: true }
);

// Indexes for efficient querying
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
