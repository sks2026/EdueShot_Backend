import express from 'express';
import authenticateToken from '../Middleware/userAuth.js';
import {
    createQuiz,
    getAllQuizzes,
    getMyQuizzes,
    getQuizById,
    updateQuiz,
    deleteQuiz,
    getQuizzesForStudentDashboard,
    getStudentDashboardQuizzes,
    startQuiz,
    getQuizQuestion,
    submitAnswer,
    completeQuiz,
    getQuizResult,
    getRecentPlayedQuizzes,
    getQuizRankings,
    // Paid quiz functions
    createQuizEnrollmentOrder,
    verifyQuizEnrollmentPayment,
    checkQuizEnrollment,
    getPaidQuizzes,
    declareQuizWinners,
    getQuizWinners,
    getStudentPrizes,
    getTeacherQuizEarnings
} from '../controllers/quizController.js';
const router = express.Router();

// Simple test route

router.post("/create", authenticateToken, createQuiz); // Teacher create quiz
router.get("/all", authenticateToken, getAllQuizzes); // Get all quizzes
router.get("/my-tests", authenticateToken, getMyQuizzes); // Get teacher's own quizzes
router.get("/my-quizzes", authenticateToken, getMyQuizzes); // Alias for my-tests
router.get("/student-dashboard", authenticateToken, getQuizzesForStudentDashboard); // Get quizzes for student dashboard (detailed)
router.get("/student-dashboard/simple", authenticateToken, getStudentDashboardQuizzes); // Get simplified quizzes for student dashboard
router.get("/recent-played", authenticateToken, getRecentPlayedQuizzes); // Get recent played quizzes for student

// Paid quiz routes
router.get("/paid", authenticateToken, getPaidQuizzes); // Get all paid quizzes
router.post("/enroll/create-order", authenticateToken, createQuizEnrollmentOrder); // Create enrollment order
router.post("/enroll/verify-payment", authenticateToken, verifyQuizEnrollmentPayment); // Verify enrollment payment
router.get("/enroll/:quizId/status", authenticateToken, checkQuizEnrollment); // Check enrollment status
router.get("/my-prizes", authenticateToken, getStudentPrizes); // Get student's won prizes
router.get("/teacher/earnings", authenticateToken, getTeacherQuizEarnings); // Get teacher's quiz earnings

// Quiz playing routes for students (MUST come before /:id route)
router.post("/:quizId/start", authenticateToken, startQuiz); // Student starts a quiz
router.get("/:quizId/question/:questionIndex", authenticateToken, getQuizQuestion); // Get specific question
router.post("/:quizId/question/:questionIndex/answer", authenticateToken, submitAnswer); // Submit answer for a question
router.post("/:quizId/complete", authenticateToken, completeQuiz); // Complete quiz with all answers
router.get("/:quizId/result", authenticateToken, getQuizResult); // Get quiz result after completion
router.get("/:quizId/rankings", authenticateToken, getQuizRankings); // Get quiz rankings/leaderboard
router.post("/:quizId/declare-winners", authenticateToken, declareQuizWinners); // Declare winners (teacher)
router.get("/:quizId/winners", authenticateToken, getQuizWinners); // Get quiz winners

// General quiz routes (MUST come after specific routes)
router.get("/:id", authenticateToken, getQuizById); // Get quiz by ID
router.put("/:id", authenticateToken, updateQuiz); // Teacher update quiz
router.delete("/:id", authenticateToken, deleteQuiz); // Teacher delete quiz

export default router;
