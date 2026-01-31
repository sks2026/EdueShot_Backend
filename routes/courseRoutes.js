import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  getMyCourses,
  enrollCourse,
  updateCourse,
  deleteCourse,
} from "../controllers/courseController.js";
import authenticateToken, { optionalAuthenticateToken } from "../Middleware/userAuth.js";
import { imageUpload, handleUploadError } from "../Middleware/s3Upload.js";

const router = express.Router();

// teacher creates (with file upload)
router.post("/create", authenticateToken, imageUpload, handleUploadError, createCourse);

// anyone can view all courses (optional auth to check enrollment status)
router.get("/", optionalAuthenticateToken, getCourses);

// IMPORTANT: /my-courses MUST be defined BEFORE /:courseId to avoid route conflicts
// This route gets teacher's own created courses
router.get("/my-courses", authenticateToken, getMyCourses);

// get single course by ID
router.get("/:courseId", getCourseById);

// student enrolls
router.post("/:courseId/enroll", authenticateToken, enrollCourse);

// teacher updates/deletes own course
router.put("/:courseId", authenticateToken, updateCourse);
router.delete("/:courseId", authenticateToken, deleteCourse);

export default router;
