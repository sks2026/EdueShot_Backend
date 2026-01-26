import { Course } from "../Models/courseModel.js";
import User from "../Models/userModel.js";
import { createNotification } from './notificationController.js';
import path from 'path';
import fs from 'fs';

// Get base URL configuration - use production server IP
const getBaseUrl = () => {
  const defaultUrl = 'http://192.168.31.186:3002';
  const baseUrl = process.env.BASE_URL || defaultUrl;

  // Ensure BASE_URL has proper protocol
  if (baseUrl && !baseUrl.startsWith('http')) {
    return defaultUrl;
  }

  return baseUrl;
};

// Helper function to generate full URL for uploaded files
const generateFileUrl = (filename) => {
  if (!filename) return null;
  const baseUrl = getBaseUrl();
  return `${baseUrl}/uploads/${filename}`;
};

// Helper function to ensure URL is full (for backward compatibility)
const ensureFullUrl = (url) => {
  if (!url) return null;

  console.log('🖼️ Processing thumbnail URL:', url);

  // Already full URL - fix localhost references
  if (url.startsWith('http')) {
    // Replace localhost with actual server IP
    let fixedUrl = url.replace(/localhost/gi, '192.168.31.186');
    fixedUrl = fixedUrl.replace(/127\.0\.0\.1/gi, '192.168.31.186');
    console.log('✅ Already full URL (fixed):', fixedUrl);
    return fixedUrl;
  }

  // Handle /uploads/ prefix
  if (url.startsWith('/uploads/')) {
    const filename = url.replace('/uploads/', '');
    const fullUrl = generateFileUrl(filename);
    console.log('✅ Generated full URL from /uploads/ path:', fullUrl);
    return fullUrl;
  }

  // Handle direct filename
  const fullUrl = generateFileUrl(url);
  console.log('✅ Generated full URL from filename:', fullUrl);
  return fullUrl;
};

// ✅ Create Course (only Teacher)
export const createCourse = async (req, res) => {
  try {
    
    
    const userId = req.user.userId; // from auth middleware
    const userRole = req.user.role; // from auth middleware

    if (userRole !== "teacher") {
      console.log('Access denied - User role is not teacher:', userRole);
      return res.status(403).json({
        success: false,
        message: "Only teachers can create courses",
        debug: {
          userRole: userRole,
          userId: userId
        }
      });
    }

    // Check if teacher is verified
    const teacher = await User.findById(userId).select('teacherVerification');
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found"
      });
    }

    if (teacher.teacherVerification?.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: "You must be a verified teacher to create courses. Please complete your KYC verification first.",
        verificationStatus: teacher.teacherVerification?.status || 'not_submitted'
      });
    }

    const { title, description, price, details } = req.body;
    
    // Get thumbnail from uploaded file or fallback to body (for backward compatibility)
    const thumbnail = req.file ? req.file.filename : req.body.thumbnail;

    if (!title || !description || !thumbnail || !price) {
      return res.status(400).json({
        success: false,
        message: "Title, description, thumbnail and price are required",
        debug: {
          hasTitle: !!title,
          hasDescription: !!description,
          hasThumbnail: !!thumbnail,
          hasPrice: !!price,
          uploadedFile: req.file ? req.file.filename : 'No file uploaded'
        }
      });
    }

    const course = new Course({
      title,
      description,
      thumbnail: thumbnail, // Store the filename as-is, we'll process URLs when retrieving
      price,
      details,
      teacher: userId,
    });

    await course.save();

    // Convert course to object and ensure thumbnail has full URL
    const courseWithFullUrl = {
      ...course.toObject(),
      thumbnail: ensureFullUrl(course.thumbnail)
    };

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      course: courseWithFullUrl,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get Teacher's Own Courses (My Created Courses)
export const getMyCourses = async (req, res) => {
  console.log('🎯 getMyCourses route hit!');
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    console.log('👤 User ID:', userId, 'Role:', userRole);

    // Check if user is teacher
    if (userRole !== "teacher") {
      return res.status(403).json({
        success: false,
        message: "Only teachers can access their created courses."
      });
    }

    // Get only courses created by this teacher
    const courses = await Course.find({ teacher: userId })
      .populate("teacher", "name email role profilePic")
      .populate("students", "name email")
      .sort({ createdAt: -1 }); // Sort by newest first

    // Ensure all thumbnail URLs are full URLs
    const coursesWithFullUrls = courses.map(course => {
      const courseObj = course.toObject();

      // Check if thumbnail file exists
      let thumbnailExists = false;
      if (courseObj.thumbnail && !courseObj.thumbnail.startsWith('http')) {
        const thumbPath = path.join(process.cwd(), 'uploads', courseObj.thumbnail);
        thumbnailExists = fs.existsSync(thumbPath);
      } else if (courseObj.thumbnail && courseObj.thumbnail.startsWith('http')) {
        thumbnailExists = true;
      }

      return {
        ...courseObj,
        thumbnail: ensureFullUrl(courseObj.thumbnail),
        thumbnailExists: thumbnailExists,
        studentsCount: courseObj.students?.length || 0,
        enrolledCount: courseObj.students?.length || 0
      };
    });

    res.status(200).json({
      success: true,
      message: "Your created courses fetched successfully",
      count: coursesWithFullUrls.length,
      courses: coursesWithFullUrls
    });
  } catch (error) {
    console.error('Get my courses error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ✅ Get All Courses (visible to all users - students, teachers, admins)
// Shows all courses from all teachers
export const getCourses = async (req, res) => {
  try {
    const courses = await Course.find()
      .populate("teacher", "name email role profilePic teacherVerification")
      .populate("students", "name email")
      .sort({ createdAt: -1 }); // Sort by newest first

    // Ensure all thumbnail URLs are full URLs and handle null teachers
    const coursesWithFullUrls = courses.map(course => {
      const courseObj = course.toObject();

      // Check if thumbnail file exists
      let thumbnailExists = false;
      if (courseObj.thumbnail && !courseObj.thumbnail.startsWith('http')) {
        const thumbPath = path.join(process.cwd(), 'uploads', courseObj.thumbnail);
        thumbnailExists = fs.existsSync(thumbPath);
        console.log(`📷 Course "${courseObj.title}" thumbnail: ${courseObj.thumbnail}, exists: ${thumbnailExists}`);
      } else if (courseObj.thumbnail && courseObj.thumbnail.startsWith('http')) {
        // External URL - assume exists
        thumbnailExists = true;
      }

      // Remove verification details from response
      if (courseObj.teacher) {
        delete courseObj.teacher.teacherVerification;
      }

      return {
        ...courseObj,
        thumbnail: ensureFullUrl(courseObj.thumbnail),
        thumbnailExists: thumbnailExists,
        studentsCount: courseObj.students?.length || 0,
        // Add flag to indicate if course is admin-created (no teacher)
        isAdminCreated: !courseObj.teacher,
        teacher: courseObj.teacher || null // Explicitly set to null if no teacher
      };
    });

    res.status(200).json({ success: true, courses: coursesWithFullUrls });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get Single Course by ID (visible to all users)
export const getCourseById = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Validate courseId is a valid MongoDB ObjectId
    if (!courseId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid course ID format"
      });
    }

    const course = await Course.findById(courseId)
      .populate("teacher", "name email role profilePic")
      .populate("students", "name email");

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // Ensure thumbnail URL is full URL and handle null teacher
    const courseObj = course.toObject();

    // Check if thumbnail file exists
    let thumbnailExists = false;
    if (courseObj.thumbnail && !courseObj.thumbnail.startsWith('http')) {
      const thumbPath = path.join(process.cwd(), 'uploads', courseObj.thumbnail);
      thumbnailExists = fs.existsSync(thumbPath);
      console.log(`📷 Course "${courseObj.title}" thumbnail: ${courseObj.thumbnail}, exists: ${thumbnailExists}`);
    } else if (courseObj.thumbnail && courseObj.thumbnail.startsWith('http')) {
      thumbnailExists = true;
    }

    const courseWithFullUrl = {
      ...courseObj,
      thumbnail: ensureFullUrl(courseObj.thumbnail),
      thumbnailExists: thumbnailExists,
      studentsCount: courseObj.students?.length || 0,
      // Add flag to indicate if course is admin-created (no teacher)
      isAdminCreated: !courseObj.teacher,
      teacher: courseObj.teacher || null // Explicitly set to null if no teacher
    };

    res.status(200).json({
      success: true,
      course: courseWithFullUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ✅ Enroll in a Course (student pays -> enroll)
export const enrollCourse = async (req, res) => {
  try {
    const userId = req.user.userId; // student
    const { courseId } = req.params;

    const course = await Course.findById(courseId).populate('teacher', 'name email');
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    if (course.students.includes(userId)) {
      return res.status(400).json({ success: false, message: "Already enrolled" });
    }

    // Get student details for notification
    const student = await User.findById(userId).select('name email');

    // here you can add payment verification logic before enrollment
    course.students.push(userId);
    await course.save();

    // Send notification to teacher about the enrollment
    if (course.teacher && course.teacher._id) {
      try {
        const isPaidCourse = course.price && course.price > 0;
        const notificationType = isPaidCourse ? 'course_purchase' : 'course_enrollment';

        await createNotification({
          recipientId: course.teacher._id,
          recipientRole: 'teacher',
          type: notificationType,
          title: isPaidCourse ? 'New Course Purchase!' : 'New Course Enrollment!',
          message: `${student?.name || 'A student'} has ${isPaidCourse ? 'purchased' : 'enrolled in'} your course "${course.title}"`,
          fromUserId: userId,
          relatedCourseId: courseId,
          data: {
            amount: course.price || 0,
            courseName: course.title,
            studentName: student?.name || 'Unknown',
            studentEmail: student?.email || ''
          }
        });
        console.log(`📬 Notification sent to teacher ${course.teacher.email} for course enrollment`);
      } catch (notifError) {
        console.error('Error sending notification to teacher:', notifError);
        // Don't fail enrollment if notification fails
      }
    }

    res.status(200).json({ success: true, message: "Enrolled successfully", course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Update Course (only teacher who created it, or admin)
export const updateCourse = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId } = req.params;

    const course = await Course.findById(courseId);

    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    // Admin can update any course, or teacher can update their own course
    if (userRole !== 'admin') {
      if (!course.teacher || course.teacher.toString() !== userId) {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized. Only the course teacher or admin can update this course." 
        });
      }
    }

    const updates = req.body;
    Object.assign(course, updates);

    await course.save();

    // Populate and format response
    const updatedCourse = await Course.findById(course._id)
      .populate("teacher", "name email role")
      .populate("students", "name email");

    const courseObj = updatedCourse.toObject();
    const courseWithFullUrl = {
      ...courseObj,
      thumbnail: ensureFullUrl(courseObj.thumbnail)
    };

    res.status(200).json({ success: true, message: "Course updated", course: courseWithFullUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Delete Course (only teacher who created it, or admin)
export const deleteCourse = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId } = req.params;

    const course = await Course.findById(courseId);

    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    // Admin can delete any course, or teacher can delete their own course
    if (userRole !== 'admin') {
      if (!course.teacher || course.teacher.toString() !== userId) {
        return res.status(403).json({ 
          success: false, 
          message: "Not authorized. Only the course teacher or admin can delete this course." 
        });
      }
    }

    await course.deleteOne();

    res.status(200).json({ success: true, message: "Course deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Like/Unlike Course

