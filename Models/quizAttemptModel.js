import mongoose from 'mongoose';

const quizAttemptSchema = new mongoose.Schema({
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
  answers: [{
    questionIndex: { type: Number, required: true },
    selectedAnswer: { type: Number, required: true },
    correctAnswer: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    questionText: { type: String, required: true },
    timeSpent: { type: Number, default: 0 } // Time spent on this question in seconds
  }],
  score: { 
    type: Number, 
    required: true,
    min: 0,
    max: 100
  },
  marksObtained: { 
    type: Number, 
    required: true 
  },
  totalMarks: { 
    type: Number, 
    required: true 
  },
  correctAnswers: { 
    type: Number, 
    required: true 
  },
  wrongAnswers: { 
    type: Number, 
    required: true 
  },
  totalQuestions: { 
    type: Number, 
    required: true 
  },
  completedAt: { 
    type: Date, 
    default: Date.now 
  },
  timeSpent: { 
    type: Number, 
    default: 0 
  }, // Total time spent on quiz in seconds
  status: {
    type: String,
    enum: ['completed', 'incomplete'],
    default: 'completed'
  }
}, { timestamps: true });

// Create compound index to prevent duplicate attempts
quizAttemptSchema.index({ studentId: 1, quizId: 1 }, { unique: true });

export default mongoose.model('QuizAttempt', quizAttemptSchema);
