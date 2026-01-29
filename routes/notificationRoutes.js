import express from 'express';
import notificationController from '../controllers/notificationController.js';
import authenticateToken from '../Middleware/userAuth.js';

const router = express.Router();

// Get my notifications
router.get('/', authenticateToken, notificationController.getMyNotifications);

// Get unread count
router.get('/unread-count', authenticateToken, notificationController.getUnreadCount);

// Mark single notification as read
router.put('/:notificationId/read', authenticateToken, notificationController.markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, notificationController.markAllAsRead);

// Delete single notification
router.delete('/:notificationId', authenticateToken, notificationController.deleteNotification);

// Delete all notifications
router.delete('/', authenticateToken, notificationController.deleteAllNotifications);

export default router;
