import Quiz from "../Models/quiz.js";
import QuizAttempt from "../Models/quizAttempt.js";
import User from "../Models/userModel.js";

// Helper function to update quiz status based on timing
const updateQuizStatus = (quiz) => {
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

// Helper function to calculate time remaining
const calculateTimeRemaining = (quiz) => {
    const now = new Date();
    const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
    const timeRemaining = Math.max(0, Math.floor((endDateTime - now) / 1000));
    return timeRemaining;
};

// Get Student Dashboard
export const getStudentDashboard = async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can access the dashboard."
            });
        }

        const studentId = req.user.userId;
        const {
            level,
            category,
            status = 'active',
            page = 1,
            limit = 10,
            sortBy = 'startDate',
            sortOrder = 'asc'
        } = req.query;

        // Build filter object
        const filter = {};
        
        if (level) {
            filter.level = level;
        }
        
        if (category) {
            filter.category = { $regex: category, $options: 'i' };
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get quizzes with pagination
        const quizzes = await Quiz.find(filter)
            .populate("createdBy", "name email")
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count for pagination
        const totalQuizzes = await Quiz.countDocuments(filter);

        // Process quizzes with status and student attempt information
        const quizzesWithStatus = await Promise.all(quizzes.map(async (quiz) => {
            const quizObj = quiz.toObject();
            const quizStatus = updateQuizStatus(quiz);
            const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
            const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
            const timeRemaining = calculateTimeRemaining(quiz);

            // Get student's attempts for this quiz
            const studentAttempts = await QuizAttempt.find({
                student: studentId,
                quiz: quiz._id
            }).sort({ createdAt: -1 });

            const hasAttempted = studentAttempts.length > 0;
            const totalAttempts = studentAttempts.length;
            const latestAttempt = studentAttempts[0] || null;
            const bestScore = studentAttempts.length > 0 ? Math.max(...studentAttempts.map(attempt => attempt.score)) : null;

            // Get quiz statistics (all attempts by all students)
            const allAttempts = await QuizAttempt.find({ quiz: quiz._id, status: 'submitted' });
            const totalAttemptsCount = allAttempts.length;
            const averageScore = allAttempts.length > 0 ? 
                Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / allAttempts.length) : 0;
            const highestScore = allAttempts.length > 0 ? Math.max(...allAttempts.map(attempt => attempt.score)) : 0;
            const lowestScore = allAttempts.length > 0 ? Math.min(...allAttempts.map(attempt => attempt.score)) : 0;

            // Filter by status if specified
            if (status !== 'all' && quizStatus !== status) {
                return null;
            }

            return {
                ...quizObj,
                totalQuestions: quiz.questions.length,
                status: quizStatus,
                timing: {
                    startDate: quiz.startDate,
                    endDate: quiz.endDate,
                    startTime: quiz.startTime,
                    endTime: quiz.endTime,
                    startDateTime,
                    endDateTime,
                    timeRemaining,
                    timeStatus: quizStatus
                },
                studentAttempts: {
                    hasAttempted,
                    canRetake: true, // Students can retake quizzes
                    totalAttempts,
                    latestAttempt: latestAttempt ? {
                        _id: latestAttempt._id,
                        score: latestAttempt.score,
                        status: latestAttempt.status,
                        submittedAt: latestAttempt.submittedAt,
                        startedAt: latestAttempt.startedAt
                    } : null,
                    bestScore
                },
                statistics: {
                    totalAttempts: totalAttemptsCount,
                    averageScore,
                    highestScore,
                    lowestScore
                }
            };
        }));

        // Filter out null values (quizzes that don't match status filter)
        const filteredQuizzes = quizzesWithStatus.filter(quiz => quiz !== null);

        // Get student statistics
        const studentStats = await QuizAttempt.aggregate([
            { $match: { student: mongoose.Types.ObjectId(studentId), status: 'submitted' } },
            {
                $group: {
                    _id: null,
                    totalAttempts: { $sum: 1 },
                    averageScore: { $avg: '$score' },
                    bestScore: { $max: '$score' },
                    totalQuizzesAttempted: { $addToSet: '$quiz' }
                }
            }
        ]);

        const studentStatistics = studentStats.length > 0 ? {
            totalAttempts: studentStats[0].totalAttempts,
            averageScore: Math.round(studentStats[0].averageScore || 0),
            bestScore: studentStats[0].bestScore || 0,
            totalQuizzesAttempted: studentStats[0].totalQuizzesAttempted.length
        } : {
            totalAttempts: 0,
            averageScore: 0,
            bestScore: 0,
            totalQuizzesAttempted: 0
        };

        // Calculate pagination info
        const totalPages = Math.ceil(totalQuizzes / parseInt(limit));
        const hasNextPage = parseInt(page) < totalPages;
        const hasPrevPage = parseInt(page) > 1;

        res.status(200).json({
            success: true,
            dashboard: {
                student: {
                    _id: req.user.userId,
                    name: req.user.name,
                    email: req.user.email
                },
                statistics: studentStatistics,
                quizzes: filteredQuizzes,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalQuizzes,
                    hasNextPage,
                    hasPrevPage
                },
                filters: {
                    level: level || null,
                    category: category || null,
                    status,
                    sortBy,
                    sortOrder
                }
            }
        });

    } catch (error) {
        console.error('Get student dashboard error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching student dashboard",
            error: error.message
        });
    }
};

// Get Quiz Details for Student
export const getQuizDetailsForStudent = async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can view quiz details."
            });
        }

        const { quizId } = req.params;
        const studentId = req.user.userId;

        // Get quiz details
        const quiz = await Quiz.findById(quizId).populate("createdBy", "name email");
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: "Quiz not found."
            });
        }

        const quizObj = quiz.toObject();
        const quizStatus = updateQuizStatus(quiz);
        const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
        const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
        const timeRemaining = calculateTimeRemaining(quiz);

        // Get student's attempts for this quiz
        const studentAttempts = await QuizAttempt.find({
            student: studentId,
            quiz: quizId
        }).sort({ createdAt: -1 });

        const hasAttempted = studentAttempts.length > 0;
        const totalAttempts = studentAttempts.length;
        const latestAttempt = studentAttempts[0] || null;
        const bestScore = studentAttempts.length > 0 ? Math.max(...studentAttempts.map(attempt => attempt.score)) : null;

        // Get quiz statistics (all attempts by all students)
        const allAttempts = await QuizAttempt.find({ quiz: quizId, status: 'submitted' });
        const totalAttemptsCount = allAttempts.length;
        const averageScore = allAttempts.length > 0 ? 
            Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / allAttempts.length) : 0;
        const highestScore = allAttempts.length > 0 ? Math.max(...allAttempts.map(attempt => attempt.score)) : 0;
        const lowestScore = allAttempts.length > 0 ? Math.min(...allAttempts.map(attempt => attempt.score)) : 0;

        res.status(200).json({
            success: true,
            quiz: {
                ...quizObj,
                totalQuestions: quiz.questions.length,
                status: quizStatus,
                timing: {
                    startDate: quiz.startDate,
                    endDate: quiz.endDate,
                    startTime: quiz.startTime,
                    endTime: quiz.endTime,
                    startDateTime,
                    endDateTime,
                    timeRemaining,
                    timeStatus: quizStatus
                },
                studentAttempts: {
                    hasAttempted,
                    canRetake: true,
                    totalAttempts,
                    latestAttempt: latestAttempt ? {
                        _id: latestAttempt._id,
                        score: latestAttempt.score,
                        status: latestAttempt.status,
                        submittedAt: latestAttempt.submittedAt,
                        startedAt: latestAttempt.startedAt
                    } : null,
                    bestScore
                },
                statistics: {
                    totalAttempts: totalAttemptsCount,
                    averageScore,
                    highestScore,
                    lowestScore
                }
            }
        });

    } catch (error) {
        console.error('Get quiz details error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching quiz details",
            error: error.message
        });
    }
};

// Get Student's Quiz Attempt History
export const getStudentAttemptHistory = async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can view their attempt history."
            });
        }

        const studentId = req.user.userId;
        const { quizId, page = 1, limit = 10 } = req.query;

        // Build filter
        const filter = { student: studentId };
        if (quizId) {
            filter.quiz = quizId;
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get attempts with pagination
        const attempts = await QuizAttempt.find(filter)
            .populate('quiz', 'title description category level totalMarks')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count
        const totalAttempts = await QuizAttempt.countDocuments(filter);

        // Calculate pagination info
        const totalPages = Math.ceil(totalAttempts / parseInt(limit));
        const hasNextPage = parseInt(page) < totalPages;
        const hasPrevPage = parseInt(page) > 1;

        res.status(200).json({
            success: true,
            attempts: attempts.map(attempt => ({
                _id: attempt._id,
                quiz: attempt.quiz,
                score: attempt.score,
                status: attempt.status,
                startedAt: attempt.startedAt,
                submittedAt: attempt.submittedAt,
                totalTimeSpent: attempt.totalTimeSpent,
                totalQuestions: attempt.answers.length,
                correctAnswers: attempt.answers.filter(answer => answer.isCorrect).length
            })),
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalAttempts,
                hasNextPage,
                hasPrevPage
            }
        });

    } catch (error) {
        console.error('Get student attempt history error:', error);
        res.status(500).json({
            success: false,
            message: "Error fetching attempt history",
            error: error.message
        });
    }
};

