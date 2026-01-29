import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: function() { return this.isVerified === true; } },
    email: { type: String, required: true },
    password: { type: String, required: function() { return this.isVerified === true; } },
    role: { type: String, enum: ['teacher', 'student', 'admin'], required: function() { return this.isVerified === true; } },
    profilePic: { type: String, default: null }, // Profile picture URL
    mobile: { type: String, default: null }, // Mobile number
    otp: { type: String },
    otpExpires: { type: Date },
    forgotPasswordOtp: { type: String },
    forgotPasswordExpiry: { type: Date },
    isVerified: { type: Boolean, default: false },
    quizAttempts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' }], // Track attempted quizzes
    // Teacher permission for paid quiz creation (only admin can enable this)
    canCreatePaidQuiz: { type: Boolean, default: false },

    // Teacher Verification Fields (KYC)
    teacherVerification: {
      status: {
        type: String,
        enum: ['not_submitted', 'pending', 'approved', 'rejected'],
        default: 'not_submitted'
      },
      aadharFront: { type: String, default: null }, // Aadhar card front image
      aadharBack: { type: String, default: null }, // Aadhar card back image
      panCard: { type: String, default: null }, // PAN card image
      marksheet: { type: String, default: null }, // Marksheet/qualification proof
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectionReason: { type: String, default: null }
    },

    // Student Verification Fields (KYC)
    studentVerification: {
      status: {
        type: String,
        enum: ['not_submitted', 'pending', 'approved', 'rejected'],
        default: 'not_submitted'
      },
      aadharFront: { type: String, default: null }, // Aadhar card front image
      aadharBack: { type: String, default: null }, // Aadhar card back image
      studentId: { type: String, default: null }, // Student ID card image
      marksheet: { type: String, default: null }, // Marksheet/qualification proof
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      rejectionReason: { type: String, default: null }
    },

    // Soft Delete Fields
    isActive: { type: Boolean, default: true }, // Account status
    deletionRequested: { type: Boolean, default: false }, // Has user requested deletion
    deletionRequestedAt: { type: Date, default: null }, // When deletion was requested
    deletionReason: { type: String, default: null }, // Reason for account deletion
    deletionStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none'
    }, // Admin approval status
    deletionApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Admin who approved
    deletionApprovedAt: { type: Date, default: null }, // When admin approved
    deactivatedAt: { type: Date, default: null } // When account was deactivated
  },
  { timestamps: true }
);

// Compound unique index: same email can be used for different roles
// But same email + same role combination must be unique
userSchema.index({ email: 1, role: 1 }, { unique: true, sparse: true });

export default mongoose.model('User', userSchema);