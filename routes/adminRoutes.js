import express from 'express';
import adminController from '../controllers/adminController.js';
import authenticateToken, { adminOnly } from '../Middleware/userAuth.js';
import { courseUpload, videoUpload, handleUploadError } from '../Middleware/s3Upload.js';

const router = express.Router();

// Admin login (can also use regular login endpoint)
router.post('/login', adminController.adminLogin);

// Create Admin (one-time setup - protected by secret key from .env)
router.post('/create', adminController.createAdmin);

// Dashboard statistics (admin only)
router.get('/dashboard/stats', authenticateToken, adminOnly, adminController.getDashboardStats);

// User management (admin only)
router.get('/users', authenticateToken, adminOnly, adminController.getAllUsers);
router.get('/users/:id', authenticateToken, adminOnly, adminController.getUserById);
router.put('/users/:id', authenticateToken, adminOnly, adminController.updateUser);
router.delete('/users/:id', authenticateToken, adminOnly, adminController.deleteUser);

// Student management (admin only - only for students)
router.get('/students', authenticateToken, adminOnly, adminController.getAllStudents);
router.get('/students/:id', authenticateToken, adminOnly, adminController.getStudentById);
router.put('/students/:id', authenticateToken, adminOnly, adminController.updateStudent);
router.delete('/students/:id', authenticateToken, adminOnly, adminController.deleteStudent);

// Teacher management (admin only - only for teachers)
router.get('/teachers', authenticateToken, adminOnly, adminController.getAllTeachers);
router.get('/teachers/:id', authenticateToken, adminOnly, adminController.getTeacherById);
router.put('/teachers/:id', authenticateToken, adminOnly, adminController.updateTeacher);
router.delete('/teachers/:id', authenticateToken, adminOnly, adminController.deleteTeacher);

// Teacher paid quiz permission management (admin only)
router.get('/teachers/paid-quiz-status/all', authenticateToken, adminOnly, adminController.getTeachersPaidQuizStatus);
router.put('/teachers/:teacherId/paid-quiz-permission', authenticateToken, adminOnly, adminController.toggleTeacherPaidQuizPermission);

// Course management (admin only)
router.get('/courses', authenticateToken, adminOnly, adminController.getAllCourses);
router.get('/courses/admin-created', authenticateToken, adminOnly, adminController.getAdminCreatedCourses);
router.get('/courses/:id', authenticateToken, adminOnly, adminController.getCourseById);
router.post('/courses', authenticateToken, adminOnly, courseUpload, handleUploadError, adminController.createCourse);
router.put('/courses/:id', authenticateToken, adminOnly, courseUpload, handleUploadError, adminController.updateCourse);
router.delete('/courses/:id', authenticateToken, adminOnly, adminController.deleteCourse);

// Payment management removed (payment system removed)

// Quiz management (admin only)
router.get('/quizzes', authenticateToken, adminOnly, adminController.getAllQuizzes);
router.get('/quizzes/admin-created', authenticateToken, adminOnly, adminController.getAdminCreatedQuizzes);

// Quiz attempts and rankings (admin only) - MUST come before :id route
router.get('/quizzes/:quizId/attempts', authenticateToken, adminOnly, adminController.getQuizAttempts);
router.get('/quizzes/:quizId/rankings', authenticateToken, adminOnly, adminController.getQuizRankings);

// General quiz routes - MUST come after specific routes
router.get('/quizzes/:id', authenticateToken, adminOnly, adminController.getQuizById);
router.post('/quizzes', authenticateToken, adminOnly, adminController.createQuiz);
router.put('/quizzes/:id', authenticateToken, adminOnly, adminController.updateQuiz);
router.delete('/quizzes/:id', authenticateToken, adminOnly, adminController.deleteQuiz);

// Video management (admin only)
router.get('/videos', authenticateToken, adminOnly, adminController.getAllVideos);
router.post('/videos', authenticateToken, adminOnly, videoUpload, handleUploadError, adminController.createVideo);
router.put('/videos/:id', authenticateToken, adminOnly, videoUpload, handleUploadError, adminController.updateVideo);
router.delete('/videos/:id', authenticateToken, adminOnly, adminController.deleteVideo);

// Withdrawal management (admin only)
router.get('/withdrawals', authenticateToken, adminOnly, adminController.getAllWithdrawals);
router.put('/withdrawals/:id/approve', authenticateToken, adminOnly, adminController.approveWithdrawal);
router.put('/withdrawals/:id/reject', authenticateToken, adminOnly, adminController.rejectWithdrawal);
router.put('/withdrawals/:id/complete', authenticateToken, adminOnly, adminController.completeWithdrawal);

// Support & Feedback management (admin only) - using support controller
import {
  upsertSupportContent,
  getAllSupportContent,
  getAllFeedback,
  respondToFeedback,
  deleteAttachment
} from '../controllers/supportController.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Setup multer for support content attachments
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const filename = Date.now() + '-' + file.originalname;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /pdf|doc|docx|txt|jpg|jpeg|png|gif/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, TXT, and image files allowed!'));
    }
  }
});

router.post('/support/content', authenticateToken, adminOnly, upload.array('attachments', 10), upsertSupportContent);
router.get('/support/content', authenticateToken, adminOnly, getAllSupportContent);
router.delete('/support/content/:type/attachment/:attachmentId', authenticateToken, adminOnly, deleteAttachment);
router.get('/support/feedback', authenticateToken, adminOnly, getAllFeedback);
router.post('/support/feedback/:feedbackId/respond', authenticateToken, adminOnly, respondToFeedback);
router.get('/support/feedback/debug', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { Feedback } = await import('../Models/feedbackModel.js');
    const feedbacks = await Feedback.find({}).populate('userId', 'name email role').select('userId type subject status createdAt');
    res.json({
      success: true,
      count: feedbacks.length,
      feedbacks: feedbacks.map(f => ({
        id: f._id,
        userId: f.userId?._id?.toString() || f.userId?.toString(),
        userName: f.userId?.name || 'N/A',
        userEmail: f.userId?.email || 'N/A',
        type: f.type,
        subject: f.subject,
        status: f.status,
        createdAt: f.createdAt
      }))
    });
  } catch (error) {
    console.error('Debug feedback error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

