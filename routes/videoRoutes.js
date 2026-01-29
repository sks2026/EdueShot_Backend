import express from 'express';
import VideoController from '../controllers/videoController.js';
import { authenticateToken, teacherOnly } from '../Middleware/userAuth.js';
import { videoUpload, handleUploadError } from '../Middleware/upload.js';

const router = express.Router();

router.post(
  '/upload',
  authenticateToken,
  teacherOnly, // Only teachers can upload videos
  videoUpload,
  handleUploadError,
  VideoController.uploadVideo
);

router.get('/videos', VideoController.getAllVideos);
router.get('/stream', VideoController.streamAllVideos); // Stream all videos without ID (perfect for feed)
router.get('/videos/type/:type', VideoController.getVideosByType); // Get videos by content type (reel/full)

// Save/Bookmark endpoints
// IMPORTANT: keep this BEFORE `/videos/:id` otherwise `saved` is treated as an `:id`
router.get('/videos/saved', authenticateToken, VideoController.getSavedVideos); // /api/videos/videos/saved
router.put('/videos/:id/save', authenticateToken, VideoController.saveVideo); // /api/videos/videos/:id/save

router.get('/videos/:id', authenticateToken, VideoController.getVideoById);
router.get('/videos/:id/stream', VideoController.streamVideo);
router.get('/my-videos', authenticateToken, VideoController.getMyVideos);

router.put('/videos/:id', authenticateToken, teacherOnly, videoUpload, handleUploadError, VideoController.updateVideo); // Only teachers can update their own videos
router.delete('/videos/:id', authenticateToken, teacherOnly, VideoController.deleteVideo); // Only teachers can delete videos

// Like, View, Share endpoints
router.put('/videos/:id/like', authenticateToken, VideoController.likeVideo);
router.get('/videos/:id/likes', VideoController.getLikes);
router.put('/videos/:id/view', authenticateToken, VideoController.incrementView); // Track video view
router.put('/videos/:id/share', authenticateToken, VideoController.trackShare); // Track video share
router.get('/videos/:id/stats', authenticateToken, VideoController.getVideoStats); // Get all stats

export default router;
