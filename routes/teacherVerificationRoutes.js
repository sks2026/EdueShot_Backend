import express from 'express';
import authenticateToken from '../Middleware/userAuth.js';
import { verificationDocsUpload, studentVerificationDocsUpload, handleUploadError } from '../Middleware/s3Upload.js';
import {
  submitVerificationDocuments,
  getVerificationStatus,
  getPendingVerifications,
  getAllVerifications,
  approveVerification,
  rejectVerification,
  submitStudentVerificationDocuments,
  getStudentVerificationStatus,
  getPendingStudentVerifications,
  getAllStudentVerifications,
  approveStudentVerification,
  rejectStudentVerification
} from '../controllers/teacherVerificationController.js';

const router = express.Router();

// Teacher routes
router.post('/teacher/submit', authenticateToken, verificationDocsUpload, handleUploadError, submitVerificationDocuments);
router.get('/teacher/status', authenticateToken, getVerificationStatus);

// Student routes
router.post('/student/submit', authenticateToken, studentVerificationDocsUpload, handleUploadError, submitStudentVerificationDocuments);
router.get('/student/status', authenticateToken, getStudentVerificationStatus);

// Admin routes - Teachers
router.get('/teacher/pending', authenticateToken, getPendingVerifications);
router.get('/teacher/all', authenticateToken, getAllVerifications);
router.put('/teacher/approve/:teacherId', authenticateToken, approveVerification);
router.put('/teacher/reject/:teacherId', authenticateToken, rejectVerification);

// Admin routes - Students
router.get('/student/pending', authenticateToken, getPendingStudentVerifications);
router.get('/student/all', authenticateToken, getAllStudentVerifications);
router.put('/student/approve/:studentId', authenticateToken, approveStudentVerification);
router.put('/student/reject/:studentId', authenticateToken, rejectStudentVerification);

// Debug endpoint to check all teachers with verification status
router.get('/debug/teachers', authenticateToken, async (req, res) => {
  try {
    const User = (await import('../Models/userModel.js')).default;
    const allTeachers = await User.find({ role: 'teacher' })
      .select('name email teacherVerification createdAt');
    
    const teachersData = allTeachers.map(teacher => ({
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      verificationStatus: teacher.teacherVerification?.status || 'not_set',
      submittedAt: teacher.teacherVerification?.submittedAt,
      hasDocuments: !!(teacher.teacherVerification?.aadharFront)
    }));
    
    res.json({
      success: true,
      totalTeachers: teachersData.length,
      pendingCount: teachersData.filter(t => t.verificationStatus === 'pending').length,
      teachers: teachersData
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
