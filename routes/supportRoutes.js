import express from 'express';
import authenticateToken from '../Middleware/userAuth.js';
import {
  upsertSupportContent,
  getAllSupportContent,
  getSupportContent,
  getHelpCenter,
  submitFeedback,
  getMyFeedback,
  getAllFeedback,
  respondToFeedback,
  deleteAttachment
} from '../controllers/supportController.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Get absolute uploads directory path
const uploadsDir = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const filename = Date.now() + '-' + file.originalname;
    cb(null, filename);
  }
});

// File upload middleware
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

const router = express.Router();

// Public routes - Get support content
router.get('/content/:type', getSupportContent);
router.get('/help-center', getHelpCenter);

// User routes - Submit and view feedback
router.post('/feedback', authenticateToken, submitFeedback);
router.get('/feedback/my', authenticateToken, getMyFeedback);

// Admin routes - Manage support content and feedback
router.post('/content', authenticateToken, upload.array('attachments', 10), upsertSupportContent);
router.get('/content', authenticateToken, getAllSupportContent);
router.delete('/content/:type/attachment/:attachmentId', authenticateToken, deleteAttachment);
router.get('/feedback', authenticateToken, getAllFeedback);
router.post('/feedback/:feedbackId/respond', authenticateToken, respondToFeedback);

export default router;

