import mongoose from 'mongoose';

const quizEnrollmentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  // Payment details
  orderId: {
    type: String,
    required: true
  },
  paymentId: {
    type: String
  },
  razorpayOrderId: {
    type: String
  },
  razorpayPaymentId: {
    type: String
  },
  razorpaySignature: {
    type: String
  },
  // Amount paid
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  // Enrollment status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  // Payment method
  paymentMethod: {
    type: String,
    default: 'other'
  },
  // Quiz attempt status
  hasAttempted: {
    type: Boolean,
    default: false
  },
  attemptedAt: {
    type: Date
  },
  // Prize won (if any)
  prizeWon: {
    type: Number,
    default: 0
  },
  // Prize payment status
  prizePaid: {
    type: Boolean,
    default: false
  },
  prizePaidAt: {
    type: Date
  },
  // Final rank in the quiz
  finalRank: {
    type: Number
  },
  // Final score
  finalScore: {
    type: Number
  }
}, { timestamps: true });

// Compound index to prevent duplicate enrollments
quizEnrollmentSchema.index({ studentId: 1, quizId: 1 }, { unique: true });

const QuizEnrollment = mongoose.model('QuizEnrollment', quizEnrollmentSchema);

export default QuizEnrollment;
