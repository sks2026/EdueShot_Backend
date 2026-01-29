import express from "express";
import {
  createPlaylistItem,
  getCoursePlaylist,
  getPlaylistItemById,
  updatePlaylistItem,
  deletePlaylistItem,
  reorderPlaylistItems,
  likePlaylistItem,
  incrementViewCount,
  getBaseUrlConfig,
} from "../controllers/coursePlaylist.js";
import authenticateToken from "../Middleware/userAuth.js";
import { videoUpload, handleUploadError } from "../Middleware/upload.js";

const router = express.Router();

// Get base URL configuration (no auth required)
router.get("/config", getBaseUrlConfig);

// All other routes require authentication
router.use(authenticateToken);

// Create playlist item for a course (only teacher who owns the course)
// Uses upload middleware to handle video and thumbnail files
router.post("/:courseId/items", videoUpload, handleUploadError, createPlaylistItem);

// Get all playlist items for a course (anyone can view)
router.get("/:courseId/items", getCoursePlaylist);

// Get single playlist item
router.get("/:courseId/items/:itemId", getPlaylistItemById);

// Update playlist item (only teacher who owns the course)
// Uses upload middleware to handle video and thumbnail files
router.put("/:courseId/items/:itemId", videoUpload, handleUploadError, updatePlaylistItem);

// Delete playlist item (only teacher who owns the course)
router.delete("/:courseId/items/:itemId", deletePlaylistItem);

// Reorder playlist items (only teacher who owns the course)
router.put("/:courseId/reorder", reorderPlaylistItems);

// Like/unlike playlist item (authenticated users)
router.put("/:courseId/items/:itemId/like", likePlaylistItem);

// Increment view count for playlist item
router.put("/:courseId/items/:itemId/view", incrementViewCount);

export default router;
