import mongoose from 'mongoose';

// Schema for each Question
const questionSchema = new mongoose.Schema({
    questionText: { type: String, required: true },
    options: {
        type: [String], // Array of 4 options
        validate: {
            validator: (v) => v.length === 4,
            message: "Each question must have exactly 4 options."
        },
        required: true
    },
    correctAnswer: {
        type: Number, // Index (0–3) of the correct option
        required: true,
        min: 0,
        max: 3
    },
    timeLimit: { 
        type: Number, // Time in seconds to answer
        required: true,
        min: 5,
        default: 30 // Default 30 seconds if not specified
    }
}, { _id: false });

// Main Quiz Schema
const quizSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    questions: {
        type: [questionSchema],
        validate: {
            validator: (v) => v.length > 0,
            message: "Quiz must contain at least one question."
        },
        required: true
    },
    // Quiz timing fields
    startDate: { 
        type: Date, 
        required: true 
    },
    endDate: { 
        type: Date, 
        required: true 
    },
    startTime: { 
        type: String, 
        required: true,
        validate: {
            validator: function(v) {
                // Validate time format (HH:MM)
                return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
            },
            message: "Start time must be in HH:MM format"
        }
    },
    endTime: { 
        type: String, 
        required: true,
        validate: {
            validator: function(v) {
                // Validate time format (HH:MM)
                return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
            },
            message: "End time must be in HH:MM format"
        }
    },
    // Quiz status based on timing
    status: {
        type: String,
        enum: ['scheduled', 'active', 'ended'],
        default: 'scheduled'
    },
    // Total quiz duration in minutes (optional)
    totalDuration: {
        type: Number,
        min: 1,
        default: 60 // Default 60 minutes
    },
    // Quiz difficulty level
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced', 'expert'],
        default: 'beginner'
    },
    // Total marks for the quiz
    totalMarks: {
        type: Number,
        required: true,
        default: 100
    },
    // Marks per question (calculated automatically)
    marksPerQuestion: {
        type: Number,
        default: function() {
            return this.totalMarks / this.questions.length;
        }
    },
    // Quiz category/subject
    category: {
        type: String,
        required: true,
        default: 'General'
    },
    // Quiz tags for filtering
    tags: {
        type: [String],
        default: []
    },
    // Quiz price for enrollment (0 = free)
    price: {
        type: Number,
        required: false,
        default: 0,
        min: 0
    },
    // Whether the quiz is paid
    isPaid: {
        type: Boolean,
        default: false
    },
    // Entry fee for the quiz
    entryFee: {
        type: Number,
        default: 0,
        min: 0
    },
    // Prize pool for winners
    prizePool: {
        type: Number,
        default: 0,
        min: 0
    },
    // Prize distribution (percentage of prize pool for each position)
    prizeDistribution: {
        first: { type: Number, default: 50 },   // 50% to 1st place
        second: { type: Number, default: 30 },  // 30% to 2nd place
        third: { type: Number, default: 20 }    // 20% to 3rd place
    },
    // Maximum participants allowed
    maxParticipants: {
        type: Number,
        default: 0 // 0 = unlimited
    },
    // Enrolled students
    enrolledStudents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    // Winners after quiz completion
    winners: [{
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        rank: { type: Number },
        prize: { type: Number },
        score: { type: Number },
        isPaid: { type: Boolean, default: false }
    }],
    // Whether winners have been declared
    winnersDeclared: {
        type: Boolean,
        default: false
    },
    // Platform commission percentage
    platformCommission: {
        type: Number,
        default: 10 // 10% platform fee
    }
}, { timestamps: true });

export default mongoose.model("Quiz", quizSchema);
