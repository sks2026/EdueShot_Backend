import Quiz from "../Models/quiz.js";
import User from "../Models/userModel.js";
import QuizAttempt from "../Models/quizAttemptModel.js";
import QuizEnrollment from "../Models/quizEnrollmentModel.js";
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

// Helper function to update quiz status based on timing
const updateQuizStatus = (quiz) => {
    // Check if required fields exist
    if (!quiz.startDate || !quiz.endDate || !quiz.startTime || !quiz.endTime) {
        return 'invalid';
    }
    
    const now = new Date();
    const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
    const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
    
    if (now < startDateTime) {
        return 'scheduled';
    } else if (now >= startDateTime && now <= endDateTime) {
        return 'active';
    } else {
        return 'ended';
    }
};

// ✅ Create Quiz (Teacher only)
export const createQuiz = async (req, res) => {
    try {
        const { 
            title, 
            description, 
            questions, 
            startDate, 
            endDate, 
            startTime, 
            endTime, 
            totalDuration,
            isPaid,
            entryFee,
            prizePool,
            prizeDistribution,
            maxParticipants
        } = req.body;

        // Check if user is teacher
        if (req.user.role !== "teacher") {
            return res.status(403).json({
                success: false,
                message: "Only teachers can create quizzes."
            });
        }

        // Check paid quiz permission - only allowed if admin has enabled it
        if (isPaid) {
            const teacher = await User.findById(req.user.userId);
            if (!teacher || !teacher.canCreatePaidQuiz) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to create paid quizzes. Please contact admin for permission."
                });
            }
        }

        // Validate required fields
        if (!title || !questions || !startDate || !endDate || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: "Title, questions, startDate, endDate, startTime, and endTime are required."
            });
        }

        // Validate questions array
        if (!Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Quiz must contain at least one question."
            });
        }

        // Validate each question
        for (const q of questions) {
            if (!q.questionText || !q.options || !Array.isArray(q.options) || q.options.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: "Each question must have questionText and exactly 4 options."
                });
            }
            
            if (q.correctAnswer === undefined || q.correctAnswer < 0 || q.correctAnswer > 3) {
                return res.status(400).json({
                    success: false,
                    message: "Each question must have a valid correctAnswer (0-3)."
                });
            }

            if (!q.timeLimit || q.timeLimit < 5) {
                return res.status(400).json({
                    success: false,
                    message: "Each question must have a timeLimit of at least 5 seconds."
                });
            }
        }

        // Validate dates
        const startDateTime = new Date(`${startDate}T${startTime}`);
        const endDateTime = new Date(`${endDate}T${endTime}`);
        const now = new Date();

        if (startDateTime <= now) {
            return res.status(400).json({
                success: false,
                message: "Quiz start date and time must be in the future."
            });
        }

        if (endDateTime <= startDateTime) {
            return res.status(400).json({
                success: false,
                message: "Quiz end date and time must be after start date and time."
            });
        }

        // Validate time format
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return res.status(400).json({
                success: false,
                message: "Time must be in HH:MM format (24-hour)."
            });
        }

        // Validate paid quiz requirements
        if (isPaid) {
            if (!entryFee || entryFee <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Entry fee is required for paid quizzes and must be greater than 0."
                });
            }
            if (!prizePool || prizePool <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Prize pool is required for paid quizzes and must be greater than 0."
                });
            }
        }

        // Calculate total duration if not provided
        let calculatedDuration = totalDuration;
        if (!calculatedDuration) {
            const diffInMinutes = Math.ceil((endDateTime - startDateTime) / (1000 * 60));
            calculatedDuration = diffInMinutes;
        }

        // Calculate total marks (1 mark per question by default)
        const totalMarks = questions.length;

        const quiz = new Quiz({
            title,
            description,
            questions,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            startTime,
            endTime,
            totalDuration: calculatedDuration,
            totalMarks: totalMarks,
            createdBy: req.user.userId,
            // Paid quiz fields
            isPaid: isPaid || false,
            entryFee: isPaid ? entryFee : 0,
            prizePool: isPaid ? prizePool : 0,
            prizeDistribution: isPaid && prizeDistribution ? prizeDistribution : {
                first: 50,
                second: 30,
                third: 20
            },
            maxParticipants: maxParticipants || 0
        });

        await quiz.save();
        
        res.status(201).json({ 
            success: true,
            message: isPaid ? "Paid quiz created successfully" : "Quiz created successfully", 
            quiz: {
                ...quiz.toObject(),
                startDateTime: startDateTime,
                endDateTime: endDateTime
            }
        });
    } catch (error) {
        console.error('Create quiz error:', error);
        res.status(500).json({ 
            success: false,
            message: "Error creating quiz", 
            error: error.message 
        });
    }
};

// ✅ Get Teacher's Own Quizzes (My Created Quizzes)
export const getMyQuizzes = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Check if user is teacher
        if (req.user.role !== "teacher") {
            return res.status(403).json({
                success: false,
                message: "Only teachers can access their created quizzes."
            });
        }

        // Get only quizzes created by this teacher
        const quizzes = await Quiz.find({ createdBy: userId })
            .populate("createdBy", "name email")
            .sort({ createdAt: -1 }); // Newest first

        // Add status and timing information to each quiz
        const quizzesWithStatus = quizzes.map(quiz => {
            const quizObj = quiz.toObject();
            const status = updateQuizStatus(quiz);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);

            return {
                ...quizObj,
                status,
                startDateTime,
                endDateTime,
                isActive: status === 'active',
                isScheduled: status === 'scheduled',
                isEnded: status === 'ended',
                enrolledCount: quiz.enrolledStudents?.length || 0
            };
        });

        res.status(200).json({
            success: true,
            message: "Your created quizzes fetched successfully",
            count: quizzesWithStatus.length,
            quizzes: quizzesWithStatus
        });
    } catch (error) {
        console.error('Get my quizzes error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching your quizzes",
            error: error.message
        });
    }
};

// ✅ Fetch all quizzes
export const getAllQuizzes = async (req, res) => {
    try {
        const quizzes = await Quiz.find().populate("createdBy", "name email");
        
        // Add status and timing information to each quiz
        const quizzesWithStatus = quizzes.map(quiz => {
            const quizObj = quiz.toObject();
            const status = updateQuizStatus(quiz);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
            
            return {
                ...quizObj,
                status,
                startDateTime,
                endDateTime,
                isActive: status === 'active',
                isScheduled: status === 'scheduled',
                isEnded: status === 'ended'
            };
        });
        
        res.status(200).json({
            success: true,
            quizzes: quizzesWithStatus
        });
    } catch (error) {
        console.error('Get all quizzes error:', error);
        res.status(500).json({ 
            success: false,
            message: "Error fetching quizzes", 
            error: error.message 
        });
    }
};

// ✅ Fetch single quiz
export const getQuizById = async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id).populate("createdBy", "name email");
        if (!quiz) {
            return res.status(404).json({ 
                success: false,
                message: "Quiz not found" 
            });
        }
        
        // Add status and timing information
        const quizObj = quiz.toObject();
        const status = updateQuizStatus(quiz);
        const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
        const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
        
        // Remove correct answers from questions for security
        const questionsWithoutAnswers = quizObj.questions.map(q => ({
            questionText: q.questionText,
            options: q.options,
            timeLimit: q.timeLimit
            // correctAnswer is intentionally excluded
        }));

        const quizWithStatus = {
            ...quizObj,
            questions: questionsWithoutAnswers, // Use questions without correct answers
            status,
            startDateTime,
            endDateTime,
            isActive: status === 'active',
            isScheduled: status === 'scheduled',
            isEnded: status === 'ended'
        };
        
        res.status(200).json({
            success: true,
            quiz: quizWithStatus
        });
    } catch (error) {
        console.error('Get quiz by ID error:', error);
        res.status(500).json({ 
            success: false,
            message: "Error fetching quiz", 
            error: error.message 
        });
    }
};

// ✅ Update Quiz (Teacher only - can only update own quizzes)
export const updateQuiz = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;

        // Check if user is teacher
        if (userRole !== "teacher") {
            return res.status(403).json({
                success: false,
                message: "Only teachers can update quizzes."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(id);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check if the teacher owns this quiz
        if (quiz.createdBy.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: "You can only update your own quizzes."
            });
        }

        // Check if quiz is currently active (optional - you might want to prevent update of active quizzes)
        const status = updateQuizStatus(quiz);
        if (status === 'active') {
            return res.status(400).json({
                success: false,
                message: "Cannot update an active quiz. Please wait for it to end."
            });
        }

        const {
            title,
            description,
            questions,
            startDate,
            endDate,
            startTime,
            endTime,
            totalDuration,
            level,
            category,
            totalMarks,
            tags,
            price
        } = req.body;

        // Update fields if provided
        if (title) quiz.title = title;
        if (description !== undefined) quiz.description = description;
        if (level) {
            if (!['beginner', 'intermediate', 'advanced', 'expert'].includes(level)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid level. Must be beginner, intermediate, advanced, or expert.'
                });
            }
            quiz.level = level;
        }
        if (category) quiz.category = category;
        if (totalMarks) quiz.totalMarks = totalMarks;
        if (tags && Array.isArray(tags)) quiz.tags = tags;

        // Update questions if provided
        if (questions && Array.isArray(questions)) {
            if (questions.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Quiz must contain at least one question.'
                });
            }

            for (const q of questions) {
                if (!q.questionText || !q.options || !Array.isArray(q.options) || q.options.length !== 4) {
                    return res.status(400).json({
                        success: false,
                        message: 'Each question must have questionText and exactly 4 options.'
                    });
                }
                
                if (q.correctAnswer === undefined || q.correctAnswer < 0 || q.correctAnswer > 3) {
                    return res.status(400).json({
                        success: false,
                        message: 'Each question must have a valid correctAnswer (0-3).'
                    });
                }

                if (!q.timeLimit || q.timeLimit < 5) {
                    return res.status(400).json({
                        success: false,
                        message: 'Each question must have a timeLimit of at least 5 seconds.'
                    });
                }
            }

            quiz.questions = questions;
        }

        // Update timing if provided
        if (startDate || startTime || endDate || endTime) {
            const newStartDate = startDate ? new Date(startDate) : quiz.startDate;
            const newEndDate = endDate ? new Date(endDate) : quiz.endDate;
            const newStartTime = startTime || quiz.startTime;
            const newEndTime = endTime || quiz.endTime;

            // Validate time format
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (startTime && !timeRegex.test(startTime)) {
                return res.status(400).json({
                    success: false,
                    message: 'Start time must be in HH:MM format (24-hour).'
                });
            }
            if (endTime && !timeRegex.test(endTime)) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be in HH:MM format (24-hour).'
                });
            }

            const startDateTime = new Date(`${newStartDate.toISOString().split('T')[0]}T${newStartTime}`);
            const endDateTime = new Date(`${newEndDate.toISOString().split('T')[0]}T${newEndTime}`);
            const now = new Date();

            if (startDateTime <= now) {
                return res.status(400).json({
                    success: false,
                    message: 'Quiz start date and time must be in the future.'
                });
            }

            if (endDateTime <= startDateTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Quiz end date and time must be after start date and time.'
                });
            }

            if (startDate) quiz.startDate = newStartDate;
            if (endDate) quiz.endDate = newEndDate;
            if (startTime) quiz.startTime = newStartTime;
            if (endTime) quiz.endTime = newEndTime;

            // Recalculate duration if timing changed
            if (startDate || startTime || endDate || endTime) {
                const diffInMinutes = Math.ceil((endDateTime - startDateTime) / (1000 * 60));
                quiz.totalDuration = totalDuration || diffInMinutes;
            }
        }

        if (totalDuration) {
            quiz.totalDuration = totalDuration;
        }

        if (price !== undefined) {
            const priceNum = typeof price === 'string' ? parseFloat(price) : price;
            if (!isNaN(priceNum) && priceNum >= 0) {
                quiz.price = priceNum;
            }
        }

        await quiz.save();

        // Populate createdBy
        const populatedQuiz = await Quiz.findById(quiz._id)
            .populate('createdBy', 'name email role');

        // Add status and timing information
        const quizObj = populatedQuiz.toObject();
        const updatedStatus = updateQuizStatus(quiz);
        const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
        const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);

        const quizWithStatus = {
            ...quizObj,
            status: updatedStatus,
            startDateTime,
            endDateTime,
            isActive: updatedStatus === 'active',
            isScheduled: updatedStatus === 'scheduled',
            isEnded: updatedStatus === 'ended'
        };

        res.status(200).json({
            success: true,
            message: "Quiz updated successfully.",
            quiz: quizWithStatus
        });

    } catch (error) {
        console.error('Update quiz error:', error);
        res.status(500).json({
            success: false,
            message: "Error updating quiz",
            error: error.message
        });
    }
};

// ✅ Delete Quiz (Teacher only - can only delete own quizzes)
export const deleteQuiz = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;

        // Check if user is teacher
        if (userRole !== "teacher") {
            return res.status(403).json({
                success: false,
                message: "Only teachers can delete quizzes."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(id);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check if the teacher owns this quiz
        if (quiz.createdBy.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: "You can only delete your own quizzes."
            });
        }

        // Check if quiz is currently active (optional - you might want to prevent deletion of active quizzes)
        const status = updateQuizStatus(quiz);
        if (status === 'active') {
            return res.status(400).json({
                success: false,
                message: "Cannot delete an active quiz. Please wait for it to end."
            });
        }

        // Delete the quiz
        await Quiz.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Quiz deleted successfully.",
            deletedQuiz: {
                id: quiz._id,
                title: quiz.title,
                status: status
            }
        });

    } catch (error) {
        console.error('Delete quiz error:', error);
        res.status(500).json({
            success: false,
            message: "Error deleting quiz",
            error: error.message
        });
    }
};

// ✅ Get all quizzes for student dashboard (created by teachers)
export const getQuizzesForStudentDashboard = async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({ 
                success: false,
                message: "Only students can access this endpoint." 
            });
        }

        // Get all quizzes created by teachers, populate teacher information
        const quizzes = await Quiz.find()
            .populate("createdBy", "name email")
            .sort({ createdAt: -1 }); // Sort by newest first
        
        // Add status and timing information to each quiz
        const quizzesWithStatus = quizzes.map(quiz => {
            const quizObj = quiz.toObject();
            
            // Check if startDate and endDate exist before processing
            if (!quiz.startDate || !quiz.endDate) {
                console.warn(`Quiz ${quiz._id} has missing startDate or endDate`);
                return {
                    ...quizObj,
                    status: 'invalid',
                    startDateTime: null,
                    endDateTime: null,
                    isActive: false,
                    isScheduled: false,
                    isEnded: false,
                    teacherName: quiz.createdBy?.name || 'Unknown Teacher',
                    teacherEmail: quiz.createdBy?.email || 'Unknown Email',
                    error: 'Missing start or end date'
                };
            }
            
            const status = updateQuizStatus(quiz);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
            
            return {
                ...quizObj,
                status,
                startDateTime,
                endDateTime,
                isActive: status === 'active',
                isScheduled: status === 'scheduled',
                isEnded: status === 'ended',
                teacherName: quiz.createdBy?.name || 'Unknown Teacher',
                teacherEmail: quiz.createdBy?.email || 'Unknown Email'
            };
        });
        
        res.status(200).json({
            success: true,
            message: "Quizzes fetched successfully for student dashboard",
            count: quizzesWithStatus.length,
            quizzes: quizzesWithStatus
        });
    } catch (error) {
        console.error('Get quizzes for student dashboard error:', error);
        res.status(500).json({ 
            success: false,
            message: "Error fetching quizzes for dashboard", 
            error: error.message 
        });
    }
};

// ✅ Get simplified quiz list for student dashboard (only essential info)
export const getStudentDashboardQuizzes = async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({ 
                success: false,
                message: "Only students can access this endpoint." 
            });
        }

        const studentId = req.user.userId;
        console.log('🎓 Student fetching quizzes...');
        console.log('📊 User:', req.user);

        // Get all quizzes with only essential fields - sort by newest first
        const quizzes = await Quiz.find()
            .select('title category startDate startTime endDate endTime questions createdBy createdAt')
            .populate("createdBy", "name email role")
            .sort({ createdAt: -1 }); // Sort by creation date, newest first
        
        console.log('📚 Total quizzes found:', quizzes.length);
        if (quizzes.length > 0) {
            console.log('🔍 First quiz:', {
                title: quizzes[0].title,
                createdAt: quizzes[0].createdAt,
                startDate: quizzes[0].startDate
            });
        }
        
        // Get all quiz IDs to check attempts in one query
        const quizIds = quizzes.map(quiz => quiz._id);
        
        // Check which quizzes the student has already attempted
        const attempts = await QuizAttempt.find({
            studentId: studentId,
            quizId: { $in: quizIds },
            status: 'completed'
        }).select('quizId');
        
        const attemptedQuizIds = new Set(attempts.map(attempt => attempt.quizId.toString()));
        
        // Transform to simplified format with attempt status
        const simplifiedQuizzes = quizzes.map(quiz => {
            const status = updateQuizStatus(quiz);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const hasAttempted = attemptedQuizIds.has(quiz._id.toString());
            
            // Determine creator name - show admin name if created by admin, teacher name if created by teacher
            const creatorName = quiz.createdBy?.name || 'Unknown';
            const creatorRole = quiz.createdBy?.role || 'teacher';
            
            return {
                _id: quiz._id,
                title: quiz.title,
                category: quiz.category,
                startTime: quiz.startTime,
                startDate: quiz.startDate,
                startDateTime: startDateTime,
                numberOfQuestions: quiz.questions.length,
                status: status,
                teacherName: creatorName, // This will show admin name if created by admin
                creatorName: creatorName, // Add explicit creator name field
                creatorRole: creatorRole, // Add creator role (admin/teacher)
                createdAt: quiz.createdAt,
                hasAttempted: hasAttempted // Add attempt status
            };
        });
        
        console.log('✅ Returning', simplifiedQuizzes.length, 'quizzes');
        console.log('📋 Quiz IDs:', simplifiedQuizzes.map(q => ({ id: q._id, title: q.title, hasAttempted: q.hasAttempted })));
        
        res.status(200).json({
            success: true,
            message: "Student dashboard quizzes fetched successfully",
            count: simplifiedQuizzes.length,
            quizzes: simplifiedQuizzes
        });
    } catch (error) {
        console.error('Get student dashboard quizzes error:', error);
        res.status(500).json({ 
            success: false,
            message: "Error fetching student dashboard quizzes", 
            error: error.message 
        });
    }
};

// ✅ Start Quiz - Student begins playing a quiz
export const startQuiz = async (req, res) => {
    try {
        const { quizId } = req.params;
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can start quizzes."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check quiz status
        const status = updateQuizStatus(quiz);
        if (status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Quiz is not currently active. Status: ${status}`,
                quizStatus: status
            });
        }

        // Check if student has already attempted this quiz
        const student = await User.findById(studentId);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        // Check if student has already attempted this quiz
        if (student.quizAttempts && student.quizAttempts.includes(quizId)) {
            return res.status(400).json({
                success: false,
                message: "You have already attempted this quiz."
            });
        }

        // Create quiz session data
        const quizSession = {
            quizId: quiz._id,
            studentId: studentId,
            startTime: new Date(),
            currentQuestionIndex: 0,
            answers: [],
            totalQuestions: quiz.questions.length,
            timeRemaining: quiz.totalDuration * 60 // Convert minutes to seconds
        };

        res.status(200).json({
            success: true,
            message: "Quiz started successfully",
            quizSession: {
                quizId: quiz._id,
                title: quiz.title,
                description: quiz.description,
                totalQuestions: quiz.questions.length,
                totalDuration: quiz.totalDuration,
                timeRemaining: quizSession.timeRemaining,
                currentQuestionIndex: 0
            }
        });

    } catch (error) {
        console.error('Start quiz error:', error);
        res.status(500).json({
            success: false,
            message: "Error starting quiz",
            error: error.message
        });
    }
};

// ✅ Get Quiz Question - Fetch a specific question for the student
export const getQuizQuestion = async (req, res) => {
    try {
        const { quizId, questionIndex } = req.params;
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can access quiz questions."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check quiz status
        const status = updateQuizStatus(quiz);
        if (status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Quiz is not currently active. Status: ${status}`,
                quizStatus: status
            });
        }

        // Validate question index
        const questionIdx = parseInt(questionIndex);
        if (isNaN(questionIdx) || questionIdx < 0 || questionIdx >= quiz.questions.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid question index."
            });
        }

        const question = quiz.questions[questionIdx];

        // Return question without correct answer - explicitly exclude correctAnswer
        const questionForStudent = {
            questionIndex: questionIdx,
            questionText: question.questionText,
            options: question.options,
            timeLimit: question.timeLimit,
            totalQuestions: quiz.questions.length,
            quizTitle: quiz.title
            // Note: correctAnswer is intentionally excluded for security
        };

        res.status(200).json({
            success: true,
            message: "Question fetched successfully",
            question: questionForStudent
        });

    } catch (error) {
        console.error('Get quiz question error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching question",
            error: error.message
        });
    }
};

// ✅ Submit Answer - Student submits answer for a question
export const submitAnswer = async (req, res) => {
    try {
        const { quizId, questionIndex } = req.params;
        const { selectedAnswer } = req.body;
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can submit answers."
            });
        }

        // Validate selected answer
        if (selectedAnswer === undefined || selectedAnswer < 0 || selectedAnswer > 3) {
            return res.status(400).json({
                success: false,
                message: "Invalid answer. Please select an option between 0-3."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check quiz status
        const status = updateQuizStatus(quiz);
        if (status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Quiz is not currently active. Status: ${status}`,
                quizStatus: status
            });
        }

        // Validate question index
        const questionIdx = parseInt(questionIndex);
        if (isNaN(questionIdx) || questionIdx < 0 || questionIdx >= quiz.questions.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid question index."
            });
        }

        const question = quiz.questions[questionIdx];
        const isCorrect = selectedAnswer === question.correctAnswer;

        // For now, we'll just return the result
        // In a real application, you'd want to store this in a separate QuizAttempt model
        res.status(200).json({
            success: true,
            message: "Answer submitted successfully",
            result: {
                questionIndex: questionIdx,
                selectedAnswer: selectedAnswer,
                correctAnswer: question.correctAnswer,
                isCorrect: isCorrect,
                nextQuestionIndex: questionIdx + 1,
                isLastQuestion: questionIdx === quiz.questions.length - 1
            }
        });

    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({
            success: false,
            message: "Error submitting answer",
            error: error.message
        });
    }
};

// ✅ Complete Quiz - Student finishes the quiz
export const completeQuiz = async (req, res) => {
    try {
        const { quizId } = req.params;
        const { answers } = req.body; // Array of {questionIndex, selectedAnswer}
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can complete quizzes."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check quiz status
        const status = updateQuizStatus(quiz);
        if (status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Quiz is not currently active. Status: ${status}`,
                quizStatus: status
            });
        }

        // Validate answers array
        if (!Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Answers array is required and cannot be empty."
            });
        }

        // Calculate score
        let correctAnswers = 0;
        const detailedResults = [];

        answers.forEach(answer => {
            const questionIdx = answer.questionIndex;
            const selectedAnswer = answer.selectedAnswer;
            
            if (questionIdx >= 0 && questionIdx < quiz.questions.length) {
                const question = quiz.questions[questionIdx];
                const isCorrect = selectedAnswer === question.correctAnswer;
                
                if (isCorrect) {
                    correctAnswers++;
                }
                
                detailedResults.push({
                    questionIndex: questionIdx,
                    questionText: question.questionText,
                    selectedAnswer: selectedAnswer,
                    correctAnswer: question.correctAnswer,
                    isCorrect: isCorrect
                });
            }
        });

        const totalQuestions = quiz.questions.length;
        const score = (correctAnswers / totalQuestions) * 100;
        const marksObtained = (correctAnswers / totalQuestions) * quiz.totalMarks;

        // Check if student has already attempted this quiz
        const existingAttempt = await QuizAttempt.findOne({ 
            studentId: studentId, 
            quizId: quizId 
        });

        if (existingAttempt) {
            return res.status(400).json({
                success: false,
                message: "You have already completed this quiz."
            });
        }

        // Create quiz attempt record
        const quizAttempt = new QuizAttempt({
            studentId: studentId,
            quizId: quizId,
            answers: detailedResults,
            score: Math.round(score * 100) / 100,
            marksObtained: Math.round(marksObtained * 100) / 100,
            totalMarks: quiz.totalMarks,
            correctAnswers: correctAnswers,
            wrongAnswers: totalQuestions - correctAnswers,
            totalQuestions: totalQuestions,
            completedAt: new Date(),
            status: 'completed'
        });

        await quizAttempt.save();

        // Mark quiz as attempted for the student
        const student = await User.findById(studentId);
        if (student) {
            if (!student.quizAttempts) {
                student.quizAttempts = [];
            }
            if (!student.quizAttempts.includes(quizId)) {
                student.quizAttempts.push(quizId);
                await student.save();
            }
        }

        res.status(200).json({
            success: true,
            message: "Quiz completed successfully",
            results: {
                attemptId: quizAttempt._id,
                quizId: quiz._id,
                quizTitle: quiz.title,
                totalQuestions: totalQuestions,
                correctAnswers: correctAnswers,
                wrongAnswers: totalQuestions - correctAnswers,
                score: Math.round(score * 100) / 100, // Round to 2 decimal places
                marksObtained: Math.round(marksObtained * 100) / 100,
                totalMarks: quiz.totalMarks,
                completedAt: quizAttempt.completedAt,
                detailedResults: detailedResults
            }
        });

    } catch (error) {
        console.error('Complete quiz error:', error);
        res.status(500).json({
            success: false,
            message: "Error completing quiz",
            error: error.message
        });
    }
};

// ✅ Get Quiz Result - Retrieve completed quiz results
export const getQuizResult = async (req, res) => {
    try {
        const { quizId } = req.params;
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can view quiz results."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        // Check if student has attempted this quiz
        const student = await User.findById(studentId);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        // Find the quiz attempt
        const quizAttempt = await QuizAttempt.findOne({ 
            studentId: studentId, 
            quizId: quizId 
        }).populate('quizId', 'title description totalMarks');

        if (!quizAttempt) {
            return res.status(400).json({
                success: false,
                message: "You have not attempted this quiz yet."
            });
        }

        res.status(200).json({
            success: true,
            message: "Quiz results retrieved successfully",
            result: {
                attemptId: quizAttempt._id,
                quizId: quiz._id,
                quizTitle: quiz.title,
                description: quiz.description,
                totalQuestions: quizAttempt.totalQuestions,
                correctAnswers: quizAttempt.correctAnswers,
                wrongAnswers: quizAttempt.wrongAnswers,
                score: quizAttempt.score,
                marksObtained: quizAttempt.marksObtained,
                totalMarks: quizAttempt.totalMarks,
                completedAt: quizAttempt.completedAt,
                status: quizAttempt.status,
                detailedResults: quizAttempt.answers
            }
        });

    } catch (error) {
        console.error('Get quiz result error:', error);
        res.status(500).json({
            success: false,
            message: "Error retrieving quiz result",
            error: error.message
        });
    }
};

// ✅ Get Recent Played Quizzes - Get student's recent quiz attempts
export const getRecentPlayedQuizzes = async (req, res) => {
    try {
        const studentId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can view their recent played quizzes."
            });
        }

        // Get recent quiz attempts with quiz details
        const recentAttempts = await QuizAttempt.find({ studentId: studentId })
            .populate('quizId', 'title description totalMarks')
            .sort({ completedAt: -1 }) // Sort by most recent first
            .limit(10); // Limit to 10 most recent attempts

        if (recentAttempts.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No quiz attempts found",
                count: 0,
                recentQuizzes: []
            });
        }

        // Format the response
        const formattedQuizzes = recentAttempts.map(attempt => {
            const quiz = attempt.quizId;
            return {
                attemptId: attempt._id,
                quizId: quiz._id,
                testName: quiz.title,
                totalQuestions: attempt.totalQuestions,
                correctAnswers: attempt.correctAnswers,
                wrongAnswers: attempt.wrongAnswers,
                percentage: attempt.score,
                marksObtained: attempt.marksObtained,
                totalMarks: attempt.totalMarks,
                completedAt: attempt.completedAt,
                status: attempt.status,
                quizDescription: quiz.description
            };
        });

        res.status(200).json({
            success: true,
            message: "Recent played quizzes retrieved successfully",
            count: formattedQuizzes.length,
            recentQuizzes: formattedQuizzes
        });

    } catch (error) {
        console.error('Get recent played quizzes error:', error);
        res.status(500).json({
            success: false,
            message: "Error retrieving recent played quizzes",
            error: error.message
        });
    }
};

// ✅ Get Quiz Rankings/Leaderboard (for students - view rankings for a specific quiz)
export const getQuizRankings = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { limit = 100 } = req.query; // Default to top 100
    const studentId = req.user.userId; // Current logged-in student

    // Verify quiz exists
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get all attempts sorted by score (highest first) and time (fastest first for same score)
    const rankings = await QuizAttempt.find({ quizId })
      .populate('studentId', 'name email')
      .sort({ score: -1, timeSpent: 1 }) // Higher score first, then faster completion
      .limit(parseInt(limit));

    const total = await QuizAttempt.countDocuments({ quizId });

    // Add rank and check if current student is in the list
    let currentStudentRank = null;
    const rankingsWithDetails = rankings.map((attempt, index) => {
      const rank = index + 1;
      const isCurrentStudent = attempt.studentId._id.toString() === studentId;
      
      if (isCurrentStudent) {
        currentStudentRank = {
          rank,
          score: attempt.score,
          marksObtained: attempt.marksObtained,
          totalMarks: attempt.totalMarks,
          correctAnswers: attempt.correctAnswers,
          totalQuestions: attempt.totalQuestions,
          timeSpent: attempt.timeSpent,
          completedAt: attempt.completedAt
        };
      }

      return {
        rank,
        studentId: attempt.studentId._id,
        studentName: attempt.studentId.name,
        studentEmail: attempt.studentId.email,
        score: attempt.score,
        marksObtained: attempt.marksObtained,
        totalMarks: attempt.totalMarks,
        correctAnswers: attempt.correctAnswers,
        wrongAnswers: attempt.wrongAnswers,
        totalQuestions: attempt.totalQuestions,
        timeSpent: attempt.timeSpent,
        timeSpentMinutes: Math.round(attempt.timeSpent / 60),
        completedAt: attempt.completedAt,
        accuracy: ((attempt.correctAnswers / attempt.totalQuestions) * 100).toFixed(2),
        isCurrentStudent
      };
    });

    // If current student didn't attempt yet or is not in top list, get their info
    if (!currentStudentRank) {
      const studentAttempt = await QuizAttempt.findOne({ 
        quizId, 
        studentId 
      });

      if (studentAttempt) {
        // Calculate rank by counting students with better scores
        const betterScoreCount = await QuizAttempt.countDocuments({
          quizId,
          $or: [
            { score: { $gt: studentAttempt.score } },
            { 
              score: studentAttempt.score, 
              timeSpent: { $lt: studentAttempt.timeSpent } 
            }
          ]
        });

        currentStudentRank = {
          rank: betterScoreCount + 1,
          score: studentAttempt.score,
          marksObtained: studentAttempt.marksObtained,
          totalMarks: studentAttempt.totalMarks,
          correctAnswers: studentAttempt.correctAnswers,
          totalQuestions: studentAttempt.totalQuestions,
          timeSpent: studentAttempt.timeSpent,
          completedAt: studentAttempt.completedAt
        };
      }
    }

    // Calculate statistics
    const avgScore = rankings.length > 0 
      ? (rankings.reduce((sum, a) => sum + a.score, 0) / rankings.length).toFixed(2)
      : 0;
    
    const avgTimeSpent = rankings.length > 0
      ? Math.round(rankings.reduce((sum, a) => sum + a.timeSpent, 0) / rankings.length)
      : 0;

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        totalMarks: quiz.totalMarks,
        totalQuestions: quiz.questions.length
      },
      rankings: rankingsWithDetails,
      currentStudentRank,
      statistics: {
        totalParticipants: total,
        averageScore: parseFloat(avgScore),
        averageTimeSpent: avgTimeSpent,
        averageTimeSpentMinutes: Math.round(avgTimeSpent / 60),
        highestScore: rankings.length > 0 ? rankings[0].score : 0,
        lowestScore: rankings.length > 0 ? rankings[rankings.length - 1].score : 0
      }
    });

  } catch (error) {
    console.error('Get quiz rankings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching quiz rankings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// ✅ Create Quiz Enrollment Order (Student enrolls in paid quiz)
export const createQuizEnrollmentOrder = async (req, res) => {
    try {
        const { quizId } = req.body;
        const userId = req.user.userId;

        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can enroll in quizzes."
            });
        }

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        // Check if quiz is paid
        if (!quiz.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'This is a free quiz. No payment required.'
            });
        }

        // Check quiz status
        const status = updateQuizStatus(quiz);
        if (status === 'ended') {
            return res.status(400).json({
                success: false,
                message: 'This quiz has already ended.'
            });
        }

        // Check if max participants reached
        if (quiz.maxParticipants > 0 && quiz.enrolledStudents.length >= quiz.maxParticipants) {
            return res.status(400).json({
                success: false,
                message: 'Maximum participants limit reached for this quiz.'
            });
        }

        // Check if user has already enrolled
        const existingEnrollment = await QuizEnrollment.findOne({
            studentId: userId,
            quizId: quizId,
            status: 'completed'
        });

        if (existingEnrollment) {
            return res.status(400).json({
                success: false,
                message: 'You have already enrolled in this quiz.'
            });
        }

        // Also check if student is already in enrolledStudents array
        if (quiz.enrolledStudents.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'You have already enrolled in this quiz.'
            });
        }

        // Generate order ID
        const orderId = `quiz_order_${Date.now()}_${userId.toString().slice(-6)}`;

        // Save enrollment record
        const enrollment = new QuizEnrollment({
            studentId: userId,
            quizId: quizId,
            orderId: orderId,
            amount: quiz.entryFee,
            currency: 'INR',
            status: 'pending'
        });

        await enrollment.save();

        res.status(200).json({
            success: true,
            message: 'Enrollment order created successfully',
            order: {
                orderId: orderId,
                amount: quiz.entryFee,
                currency: 'INR',
                name: 'Edu-Spark Quiz',
                description: `Enrollment for: ${quiz.title}`,
                prefill: {
                    name: req.user.name || 'Student',
                    email: req.user.email
                },
                quiz: {
                    id: quiz._id,
                    title: quiz.title,
                    description: quiz.description,
                    entryFee: quiz.entryFee,
                    prizePool: quiz.prizePool,
                    prizeDistribution: quiz.prizeDistribution,
                    enrolledCount: quiz.enrolledStudents.length,
                    maxParticipants: quiz.maxParticipants
                }
            }
        });
    } catch (error) {
        console.error('Create quiz enrollment order error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating enrollment order',
            error: error.message
        });
    }
};

// ✅ Verify Quiz Enrollment Payment
export const verifyQuizEnrollmentPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, quizId } = req.body;
        const userId = req.user.userId;

        // Find the enrollment record
        const enrollment = await QuizEnrollment.findOne({
            razorpayOrderId,
            studentId: userId,
            status: 'pending'
        });

        if (!enrollment) {
            return res.status(404).json({
                success: false,
                message: 'Enrollment not found or already verified'
            });
        }

        // Payment verification (signature verification removed)
        // Note: Payment gateway integration has been removed

        // Find the quiz and add student to enrolled list
        const quiz = await Quiz.findById(enrollment.quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        // Add student to enrolled students if not already added
        if (!quiz.enrolledStudents.includes(userId)) {
            quiz.enrolledStudents.push(userId);
            await quiz.save();
        }

        // Update enrollment record
        enrollment.paymentId = razorpayPaymentId || `payment_${Date.now()}`;
        enrollment.status = 'completed';
        await enrollment.save();

        res.status(200).json({
            success: true,
            message: 'Successfully enrolled in quiz',
            enrollment: {
                id: enrollment._id,
                quizId: quiz._id,
                quizTitle: quiz.title,
                amount: enrollment.amount,
                status: enrollment.status,
                enrolledAt: new Date(),
                prizePool: quiz.prizePool,
                prizeDistribution: quiz.prizeDistribution
            }
        });
    } catch (error) {
        console.error('Verify quiz enrollment error:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying enrollment payment',
            error: error.message
        });
    }
};

// ✅ Check Quiz Enrollment Status
export const checkQuizEnrollment = async (req, res) => {
    try {
        const { quizId } = req.params;
        const userId = req.user.userId;

        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        // Check enrollment
        const isEnrolled = quiz.enrolledStudents.includes(userId);
        
        // Get enrollment details if enrolled
        let enrollmentDetails = null;
        if (isEnrolled) {
            enrollmentDetails = await QuizEnrollment.findOne({
                studentId: userId,
                quizId: quizId,
                status: 'completed'
            });
        }

        res.status(200).json({
            success: true,
            quiz: {
                id: quiz._id,
                title: quiz.title,
                isPaid: quiz.isPaid,
                entryFee: quiz.entryFee,
                prizePool: quiz.prizePool,
                prizeDistribution: quiz.prizeDistribution,
                enrolledCount: quiz.enrolledStudents.length,
                maxParticipants: quiz.maxParticipants
            },
            isEnrolled,
            enrollmentDetails: enrollmentDetails ? {
                enrolledAt: enrollmentDetails.createdAt,
                amount: enrollmentDetails.amount,
                hasAttempted: enrollmentDetails.hasAttempted,
                prizeWon: enrollmentDetails.prizeWon
            } : null
        });
    } catch (error) {
        console.error('Check quiz enrollment error:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking enrollment status',
            error: error.message
        });
    }
};

// ✅ Get Paid Quizzes (For Students to browse)
export const getPaidQuizzes = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get all paid quizzes that haven't ended
        const quizzes = await Quiz.find({ isPaid: true })
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        // Add status and enrollment info
        const quizzesWithDetails = await Promise.all(quizzes.map(async (quiz) => {
            const quizObj = quiz.toObject();
            const status = updateQuizStatus(quiz);
            
            // Skip ended quizzes (optional - you can keep them)
            // if (status === 'ended') return null;

            const isEnrolled = quiz.enrolledStudents.includes(userId);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);

            return {
                ...quizObj,
                status,
                startDateTime,
                endDateTime,
                isActive: status === 'active',
                isScheduled: status === 'scheduled',
                isEnded: status === 'ended',
                isEnrolled,
                enrolledCount: quiz.enrolledStudents.length,
                spotsLeft: quiz.maxParticipants > 0 
                    ? quiz.maxParticipants - quiz.enrolledStudents.length 
                    : null,
                teacherName: quiz.createdBy?.name || 'Unknown Teacher'
            };
        }));

        // Filter out nulls (if we skipped ended quizzes)
        const validQuizzes = quizzesWithDetails.filter(q => q !== null);

        res.status(200).json({
            success: true,
            message: 'Paid quizzes fetched successfully',
            count: validQuizzes.length,
            quizzes: validQuizzes
        });
    } catch (error) {
        console.error('Get paid quizzes error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching paid quizzes',
            error: error.message
        });
    }
};

// ✅ Declare Quiz Winners (Auto-triggered after quiz ends or manually by teacher)
export const declareQuizWinners = async (req, res) => {
    try {
        const { quizId } = req.params;
        const userId = req.user.userId;

        // Find the quiz
        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        // Only quiz creator or admin can declare winners
        if (quiz.createdBy.toString() !== userId && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only quiz creator can declare winners'
            });
        }

        // Check if winners already declared
        if (quiz.winnersDeclared) {
            return res.status(400).json({
                success: false,
                message: 'Winners have already been declared for this quiz',
                winners: quiz.winners
            });
        }

        // Check if quiz is paid
        if (!quiz.isPaid) {
            return res.status(400).json({
                success: false,
                message: 'This is a free quiz. No prizes to distribute.'
            });
        }

        // Check if quiz has ended
        const status = updateQuizStatus(quiz);
        if (status !== 'ended') {
            return res.status(400).json({
                success: false,
                message: 'Winners can only be declared after the quiz ends.'
            });
        }

        // Get top 3 attempts sorted by score and time
        const topAttempts = await QuizAttempt.find({ quizId })
            .populate('studentId', 'name email')
            .sort({ score: -1, timeSpent: 1 })
            .limit(3);

        if (topAttempts.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No participants attempted this quiz.'
            });
        }

        // Calculate prizes
        const { first, second, third } = quiz.prizeDistribution;
        const platformFee = quiz.prizePool * (quiz.platformCommission / 100);
        const distributablePrize = quiz.prizePool - platformFee;

        const winners = [];
        const prizeAmounts = [
            (distributablePrize * first) / 100,
            (distributablePrize * second) / 100,
            (distributablePrize * third) / 100
        ];

        for (let i = 0; i < topAttempts.length; i++) {
            const attempt = topAttempts[i];
            const prize = prizeAmounts[i] || 0;

            winners.push({
                studentId: attempt.studentId._id,
                rank: i + 1,
                prize: prize,
                score: attempt.score,
                isPaid: false
            });

            // Update enrollment with prize info
            await QuizEnrollment.findOneAndUpdate(
                { studentId: attempt.studentId._id, quizId },
                {
                    prizeWon: prize,
                    finalRank: i + 1,
                    finalScore: attempt.score
                }
            );
        }

        // Update quiz with winners
        quiz.winners = winners;
        quiz.winnersDeclared = true;
        await quiz.save();

        res.status(200).json({
            success: true,
            message: 'Winners declared successfully',
            quiz: {
                id: quiz._id,
                title: quiz.title,
                prizePool: quiz.prizePool,
                platformCommission: platformFee,
                distributedPrize: distributablePrize
            },
            winners: await Promise.all(winners.map(async (w, index) => {
                const student = await User.findById(w.studentId).select('name email');
                return {
                    rank: w.rank,
                    studentName: student?.name || 'Unknown',
                    studentEmail: student?.email || 'Unknown',
                    prize: w.prize,
                    score: w.score
                };
            }))
        });
    } catch (error) {
        console.error('Declare winners error:', error);
        res.status(500).json({
            success: false,
            message: 'Error declaring winners',
            error: error.message
        });
    }
};

// ✅ Get Quiz Winners
export const getQuizWinners = async (req, res) => {
    try {
        const { quizId } = req.params;

        const quiz = await Quiz.findById(quizId)
            .populate('winners.studentId', 'name email');

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        if (!quiz.winnersDeclared) {
            return res.status(400).json({
                success: false,
                message: 'Winners have not been declared yet'
            });
        }

        res.status(200).json({
            success: true,
            quiz: {
                id: quiz._id,
                title: quiz.title,
                prizePool: quiz.prizePool,
                prizeDistribution: quiz.prizeDistribution
            },
            winners: quiz.winners.map(w => ({
                rank: w.rank,
                studentName: w.studentId?.name || 'Unknown',
                studentEmail: w.studentId?.email || 'Unknown',
                prize: w.prize,
                score: w.score,
                isPaid: w.isPaid
            }))
        });
    } catch (error) {
        console.error('Get quiz winners error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching quiz winners',
            error: error.message
        });
    }
};

// ✅ Get Student's Won Prizes
export const getStudentPrizes = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get all enrollments where student won a prize
        const enrollments = await QuizEnrollment.find({
            studentId: userId,
            prizeWon: { $gt: 0 }
        }).populate('quizId', 'title prizePool');

        const totalPrizeWon = enrollments.reduce((sum, e) => sum + e.prizeWon, 0);
        const paidPrizes = enrollments.filter(e => e.prizePaid);
        const unpaidPrizes = enrollments.filter(e => !e.prizePaid);

        res.status(200).json({
            success: true,
            summary: {
                totalPrizeWon,
                paidAmount: paidPrizes.reduce((sum, e) => sum + e.prizeWon, 0),
                unpaidAmount: unpaidPrizes.reduce((sum, e) => sum + e.prizeWon, 0),
                totalWins: enrollments.length
            },
            prizes: enrollments.map(e => ({
                quizId: e.quizId?._id,
                quizTitle: e.quizId?.title || 'Unknown Quiz',
                rank: e.finalRank,
                score: e.finalScore,
                prizeAmount: e.prizeWon,
                isPaid: e.prizePaid,
                paidAt: e.prizePaidAt,
                wonAt: e.updatedAt
            }))
        });
    } catch (error) {
        console.error('Get student prizes error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching prizes',
            error: error.message
        });
    }
};

// ✅ Get Teacher's Quiz Earnings
export const getTeacherQuizEarnings = async (req, res) => {
    try {
        const userId = req.user.userId;

        if (req.user.role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: 'Only teachers can view their quiz earnings'
            });
        }

        // Get all paid quizzes created by this teacher
        const quizzes = await Quiz.find({
            createdBy: userId,
            isPaid: true
        });

        let totalEarnings = 0;
        let totalEnrollments = 0;
        const quizEarnings = [];

        for (const quiz of quizzes) {
            const enrollmentCount = quiz.enrolledStudents.length;
            const grossEarnings = enrollmentCount * quiz.entryFee;
            const platformFee = grossEarnings * (quiz.platformCommission / 100);
            
            // Teacher gets platform fee from enrollments (not from prize pool)
            // Prize pool goes to winners
            const teacherEarnings = platformFee; // Platform takes commission, teacher gets it

            totalEarnings += teacherEarnings;
            totalEnrollments += enrollmentCount;

            quizEarnings.push({
                quizId: quiz._id,
                title: quiz.title,
                entryFee: quiz.entryFee,
                prizePool: quiz.prizePool,
                enrollmentCount,
                grossEarnings,
                platformFee,
                teacherEarnings,
                winnersDeclared: quiz.winnersDeclared
            });
        }

        res.status(200).json({
            success: true,
            summary: {
                totalQuizzes: quizzes.length,
                totalEnrollments,
                totalEarnings
            },
            quizzes: quizEarnings
        });
    } catch (error) {
        console.error('Get teacher quiz earnings error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching quiz earnings',
            error: error.message
        });
    }
};