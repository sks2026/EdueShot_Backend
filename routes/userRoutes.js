import express from 'express';
import userController from '../controllers/userController.js';
import authenticateToken from '../Middleware/userAuth.js';
import { profilePicUpload, handleUploadError } from '../Middleware/upload.js';
import {
  loginLimiter,
  otpLimiter,
  passwordResetLimiter,
  registrationLimiter
} from '../Middleware/rateLimiter.js';

const router = express.Router();

// Debug route to test if routes are working
router.get('/test', (req, res) => {
  res.json({ message: 'Routes are working!', timestamp: new Date().toISOString() });
});

// Auth routes (public) with rate limiting
router.post('/register', registrationLimiter, userController.register);
router.post('/verify', otpLimiter, userController.verifyOTP);
router.post('/send-otp', otpLimiter, userController.sendOtp);
router.post('/resend-otp', otpLimiter, userController.resendOTP);
router.post('/login', loginLimiter, userController.login);
router.post('/refresh-token', userController.refreshToken);
router.post('/logout', authenticateToken, userController.logout);

// Password reset routes (public) with rate limiting
router.post('/forgot-password', passwordResetLimiter, userController.forgotPassword);
router.post('/verify-password-reset-otp', otpLimiter, userController.verifyPasswordResetOTP);
router.post('/reset-password', passwordResetLimiter, userController.resetPassword);

// Protected profile routes (require authentication)
router.get('/get/:id', authenticateToken, userController.getProfile);
router.put('/update/:id', authenticateToken, userController.updateUserProfile);
router.get('/profile', authenticateToken, userController.getMyProfile);
router.put('/profile', authenticateToken, userController.updateProfile);
router.post('/upload-profile-pic', authenticateToken, profilePicUpload, handleUploadError, userController.uploadProfilePic);
router.delete('/delete/:id', authenticateToken, userController.deleteUserProfile);
router.get('/all', authenticateToken, userController.getAllUsers);

// Account Deletion (Soft Delete) Routes
router.post('/request-deletion', authenticateToken, userController.requestAccountDeletion); // User requests account deletion
router.post('/cancel-deletion', authenticateToken, userController.cancelDeletionRequest); // User cancels deletion request
router.get('/deletion-status', authenticateToken, userController.getDeletionStatus); // Get deletion request status

// Admin Routes for Account Management
router.get('/admin/deletion-requests', authenticateToken, userController.getDeletionRequests); // Get all deletion requests
router.put('/admin/approve-deletion/:userId', authenticateToken, userController.approveAccountDeletion); // Approve deletion
router.put('/admin/reject-deletion/:userId', authenticateToken, userController.rejectAccountDeletion); // Reject deletion
router.put('/admin/reactivate/:userId', authenticateToken, userController.reactivateAccount); // Reactivate account
router.get('/admin/notifications', authenticateToken, userController.getAdminNotifications); // Get admin notifications
router.put('/admin/notifications/:notificationId/read', authenticateToken, userController.markNotificationRead); // Mark as read

export default router;