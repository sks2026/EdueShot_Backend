import User from '../Models/userModel.js';
import { Course } from '../Models/courseModel.js';
import Quiz from '../Models/quiz.js';
import QuizAttempt from '../Models/quizAttemptModel.js';
import Video from '../Models/videoModel.js';
import { Withdrawal } from '../Models/withdrawalModel.js';
import { createNotification } from './notificationController.js';
import AdminNotification from '../Models/adminNotificationModel.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Admin Login (Admin can use regular login, but this is a dedicated endpoint)
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete your registration first.'
      });
    }

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only administrators can access this endpoint.'
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT tokens - 7 days for access, 30 days for refresh
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, type: 'access' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, type: 'refresh' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      refreshToken,
      expiresIn: 604800, // 7 days in seconds
      admin: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during admin login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Dashboard Statistics
const getDashboardStats = async (req, res) => {
  try {
    // Get user statistics - Total users (all users including unverified)
    const totalUsers = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    const totalTeachers = await User.countDocuments({ role: 'teacher', isVerified: true });
    const totalStudents = await User.countDocuments({ role: 'student', isVerified: true });
    const totalAdmins = await User.countDocuments({ role: 'admin', isVerified: true });
    const unverifiedUsers = await User.countDocuments({ isVerified: false });

    // Get course statistics
    const totalCourses = await Course.countDocuments();
    const coursesWithStudents = await Course.countDocuments({ students: { $exists: true, $ne: [] } });

    // Payment statistics removed (payment system removed)
    const totalPayments = 0;
    const completedPayments = 0;
    const pendingPayments = 0;
    const failedPayments = 0;
    const totalRevenue = 0;

    // Get quiz statistics
    const totalQuizzes = await Quiz.countDocuments();

    // Get video statistics
    const totalVideos = await Video.countDocuments();
    const totalReels = await Video.countDocuments({ contentType: 'reel' });
    const totalFullVideos = await Video.countDocuments({ contentType: 'full' });

    // Get withdrawal statistics
    const totalWithdrawals = await Withdrawal.countDocuments();
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    const approvedWithdrawals = await Withdrawal.countDocuments({ status: 'approved' });
    const completedWithdrawals = await Withdrawal.countDocuments({ status: 'completed' });
    
    // Calculate total withdrawal amount
    const withdrawalData = await Withdrawal.aggregate([
      { $match: { status: { $in: ['completed', 'approved'] } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
    ]);
    const totalWithdrawalAmount = withdrawalData.length > 0 ? withdrawalData[0].totalAmount : 0;

    // Get unread admin notifications count
    const unreadAdminNotifications = await AdminNotification.countDocuments({ status: 'unread' });
    const unreadWithdrawalNotifications = await AdminNotification.countDocuments({ 
      type: 'withdrawal', 
      status: 'unread' 
    });

    // Get recent activities (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      isVerified: true
    });
    
    const recentCourses = await Course.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });
    
    const recentPayments = 0; // Payment system removed

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          teachers: totalTeachers,
          students: totalStudents,
          admins: totalAdmins,
          unverified: unverifiedUsers,
          recent: recentUsers
        },
        courses: {
          total: totalCourses,
          withStudents: coursesWithStudents,
          recent: recentCourses
        },
        payments: {
          total: totalPayments,
          completed: completedPayments,
          pending: pendingPayments,
          failed: failedPayments,
          totalRevenue: totalRevenue,
          recent: recentPayments
        },
        quizzes: {
          total: totalQuizzes
        },
        videos: {
          total: totalVideos,
          reels: totalReels,
          fullVideos: totalFullVideos
        },
        withdrawals: {
          total: totalWithdrawals,
          pending: pendingWithdrawals,
          approved: approvedWithdrawals,
          completed: completedWithdrawals,
          totalAmount: totalWithdrawalAmount
        },
        notifications: {
          unread: unreadAdminNotifications,
          unreadWithdrawals: unreadWithdrawalNotifications
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching dashboard statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Users with filtering and pagination
const getAllUsers = async (req, res) => {
  try {
    const { role, verified, page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (role) query.role = role;
    if (verified !== undefined) query.isVerified = verified === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get User by ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update User (Admin can update any user)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, isVerified } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate email format if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }

      // Check if email already exists (if changing email)
      if (email !== user.email) {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already exists'
          });
        }
      }
    }

    // Validate role if being updated
    if (role && !['teacher', 'student', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be teacher, student, or admin'
      });
    }

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;
    if (isVerified !== undefined) user.isVerified = isVerified;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete User
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (req.user.userId === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Courses
const getAllCourses = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const courses = await Course.find(query)
      .populate('teacher', 'name email role')
      .populate('students', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Ensure thumbnail URLs are full and add admin-created flag
    const coursesWithFullUrls = courses.map(course => {
      const courseObj = course.toObject();
      return {
        ...courseObj,
        thumbnail: generateFileUrl(courseObj.thumbnail),
        isAdminCreated: !courseObj.teacher,
        teacher: courseObj.teacher || null
      };
    });

    const total = await Course.countDocuments(query);

    res.json({
      success: true,
      courses: coursesWithFullUrls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all courses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching courses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Admin-Created Courses (admin only - courses without teacher)
const getAdminCreatedCourses = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Query for courses where teacher is null (admin-created)
    const query = { teacher: null };
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const courses = await Course.find(query)
      .populate('students', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Ensure thumbnail URLs are full and add admin-created flag
    const coursesWithFullUrls = courses.map(course => {
      const courseObj = course.toObject();
      return {
        ...courseObj,
        thumbnail: generateFileUrl(courseObj.thumbnail),
        isAdminCreated: true, // All courses here are admin-created
        teacher: null // Explicitly null for admin-created courses
      };
    });

    const total = await Course.countDocuments(query);

    res.json({
      success: true,
      courses: coursesWithFullUrls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get admin-created courses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching admin-created courses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Course by ID (admin only)
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    const course = await Course.findById(id)
      .populate('teacher', 'name email role')
      .populate('students', 'name email');

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Ensure thumbnail URL is full and add admin-created flag
    const courseObj = course.toObject();
    const courseWithFullUrl = {
      ...courseObj,
      thumbnail: generateFileUrl(courseObj.thumbnail),
      isAdminCreated: !courseObj.teacher,
      teacher: courseObj.teacher || null
    };

    res.json({
      success: true,
      course: courseWithFullUrl
    });

  } catch (error) {
    console.error('Get course by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching course',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate full URL for uploaded files
const generateFileUrl = (filename) => {
  if (!filename) return null;
  const defaultUrl = 'http://192.168.31.186:3002';
  let baseUrl = process.env.BASE_URL || defaultUrl;
  
  // Ensure BASE_URL has proper protocol
  if (baseUrl && !baseUrl.startsWith('http')) {
    console.warn('⚠️ Invalid BASE_URL in adminController, using default:', defaultUrl);
    baseUrl = defaultUrl;
  }
  
  // Remove any spaces from baseUrl
  baseUrl = baseUrl.replace(/\s+/g, '');
  
  return `${baseUrl}/uploads/${filename}`;
};

// Create Course (admin only - admin can create courses without requiring teacher)
const createCourse = async (req, res) => {
  try {
    const { title, description, price, details, teacherId } = req.body;

    // Check if thumbnail is uploaded as file or provided as string
    let thumbnailValue = null;
    if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
      // File uploaded via form-data
      thumbnailValue = req.files.thumbnail[0].filename;
      console.log('📁 Thumbnail file uploaded:', thumbnailValue);
    } else if (req.body.thumbnail) {
      // Thumbnail provided as string (existing file or URL)
      thumbnailValue = req.body.thumbnail;
      console.log('📝 Thumbnail provided as string:', thumbnailValue);
    }

    // Validation
    if (!title || !description || !thumbnailValue) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and thumbnail are required'
      });
    }

    // Validate price if provided (optional)
    let priceNum = 0;
    if (price !== undefined && price !== null && price !== '') {
      priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid number greater than or equal to 0'
        });
      }
    }

    // Validate teacherId if provided (optional for admin)
    let finalTeacherId = null;
    if (teacherId) {
      const teacher = await User.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found'
        });
      }
      if (teacher.role !== 'teacher') {
        return res.status(400).json({
          success: false,
          message: 'Provided user is not a teacher'
        });
      }
      finalTeacherId = teacherId;
    }
    // If no teacherId provided, teacher will be null
    // Admin can create courses without teacher and assign one later via update

    // Parse details from form-data or JSON string
    let parsedDetails = {};
    
    // Debug: Log all request body keys to see what we're receiving
    console.log('🔍 Request body keys:', Object.keys(req.body));
    console.log('🔍 Request body:', JSON.stringify(req.body, null, 2));
    
    // Check if details come as form-data fields (details.duration, details[level], etc.)
    const detailsKeys = Object.keys(req.body).filter(key => 
      key.startsWith('details.') || key.startsWith('details[')
    );
    
    console.log('🔍 Details keys found:', detailsKeys);
    
    if (detailsKeys.length > 0) {
      // Build details object from form-data fields
      // First, identify which fields are arrays (have [] or [index] in the key)
      const arrayFields = new Set();
      const regularFields = new Map(); // Map to store regular field values
      
      // Process all details keys
      detailsKeys.forEach(key => {
        // Check for array notation: details[field][] or details[field][0]
        const arrayMatch = key.match(/^details\[(\w+)\](?:\[\]|\[(\d+)\])$/);
        const dotArrayMatch = key.match(/^details\.(\w+)\[\]$/);
        
        if (arrayMatch) {
          // Array field: details[content][] or details[content][0]
          const fieldName = arrayMatch[1];
          arrayFields.add(fieldName);
        } else if (dotArrayMatch) {
          // Array field: details.content[]
          const fieldName = dotArrayMatch[1];
          arrayFields.add(fieldName);
        } else {
          // Regular field: details[duration] or details.level
          let fieldName;
          if (key.startsWith('details.')) {
            fieldName = key.replace('details.', '');
          } else if (key.startsWith('details[')) {
            fieldName = key.replace('details[', '').replace(']', '');
          }
          
          if (fieldName && !arrayFields.has(fieldName)) {
            regularFields.set(fieldName, req.body[key]);
          }
        }
      });
      
      // Add regular fields to parsedDetails
      regularFields.forEach((value, fieldName) => {
        parsedDetails[fieldName] = value;
      });
      
      // Handle array fields: collect all values for each array field
      arrayFields.forEach(fieldName => {
        parsedDetails[fieldName] = [];
        
        // Collect all values for this array field from req.body
        Object.keys(req.body).forEach(key => {
          // Match indexed arrays: details[content][0], details[content][1]
          const indexedMatch = key.match(/^details\[(\w+)\]\[(\d+)\]$/);
          // Match bracket arrays: details[content][]
          const bracketMatch = key.match(/^details\[(\w+)\]\[\]$/);
          // Match dot arrays: details.content[]
          const dotBracketMatch = key.match(/^details\.(\w+)\[\]$/);
          
          if (indexedMatch && indexedMatch[1] === fieldName) {
            const index = parseInt(indexedMatch[2]);
            const value = req.body[key];
            if (value !== undefined && value !== null && value !== '') {
              // Ensure array is large enough
              while (parsedDetails[fieldName].length <= index) {
                parsedDetails[fieldName].push(null);
              }
              parsedDetails[fieldName][index] = value;
            }
          } else if ((bracketMatch && bracketMatch[1] === fieldName) || 
                     (dotBracketMatch && dotBracketMatch[1] === fieldName)) {
            const value = req.body[key];
            if (value !== undefined && value !== null && value !== '') {
              parsedDetails[fieldName].push(value);
            }
          }
        });
        
        // Clean up array: remove null/undefined entries and flatten
        parsedDetails[fieldName] = parsedDetails[fieldName]
          .filter(val => val !== undefined && val !== null && val !== '');
        
        // If array is empty after cleanup, check if it was sent as a single string or comma-separated
        if (parsedDetails[fieldName].length === 0) {
          // Try to find it as a single value (in case only one item was sent)
          const singleKey = `details[${fieldName}]`;
          const dotSingleKey = `details.${fieldName}`;
          
          let value = req.body[singleKey] || req.body[dotSingleKey];
          
          if (value) {
            // Check if it's comma-separated
            if (typeof value === 'string' && value.includes(',')) {
              parsedDetails[fieldName] = value.split(',').map(v => v.trim()).filter(v => v);
            } else {
              parsedDetails[fieldName] = [value];
            }
          }
        } else if (parsedDetails[fieldName].length === 1 && typeof parsedDetails[fieldName][0] === 'string') {
          // If only one value but it might be comma-separated, split it
          const value = parsedDetails[fieldName][0];
          if (value.includes(',')) {
            parsedDetails[fieldName] = value.split(',').map(v => v.trim()).filter(v => v);
          }
        }
      });
      
      console.log('✅ Parsed details:', JSON.stringify(parsedDetails, null, 2));
    } else if (details) {
      // Try parsing as JSON string (backward compatibility)
      try {
        parsedDetails = typeof details === 'string' ? JSON.parse(details) : details;
        console.log('✅ Parsed details from JSON:', JSON.stringify(parsedDetails, null, 2));
      } catch (e) {
        console.error('❌ Error parsing JSON details:', e);
        parsedDetails = {};
      }
    }

    // Validate details if provided
    if (parsedDetails && parsedDetails.level) {
      const validLevels = ['Beginner', 'Intermediate', 'Advanced'];
      if (!validLevels.includes(parsedDetails.level)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid level. Must be Beginner, Intermediate, or Advanced'
        });
      }
    }

    // Create course
    const courseData = {
      title,
      description,
      thumbnail: thumbnailValue,
      price: priceNum || 0, // Price is optional, default to 0
      details: parsedDetails
    };

    // Only set teacher if provided
    if (finalTeacherId) {
      courseData.teacher = finalTeacherId;
    }

    const course = new Course(courseData);

    await course.save();

    // Populate course data
    const populatedCourse = await Course.findById(course._id)
      .populate('teacher', 'name email role')
      .populate('students', 'name email');

    // Ensure thumbnail URL is full
    populatedCourse.thumbnail = generateFileUrl(populatedCourse.thumbnail);

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      course: populatedCourse
    });

  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating course',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Course (admin only)
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, details, teacherId } = req.body;

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check if thumbnail is uploaded as file or provided as string
    if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
      // File uploaded via form-data
      course.thumbnail = req.files.thumbnail[0].filename;
      console.log('📁 Thumbnail file uploaded:', course.thumbnail);
    } else if (req.body.thumbnail) {
      // Thumbnail provided as string (existing file or URL)
      course.thumbnail = req.body.thumbnail;
      console.log('📝 Thumbnail provided as string:', course.thumbnail);
    }

    // Validate teacherId if being updated
    if (teacherId) {
      const teacher = await User.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found'
        });
      }
      if (teacher.role !== 'teacher') {
        return res.status(400).json({
          success: false,
          message: 'Provided user is not a teacher'
        });
      }
      course.teacher = teacherId;
    }

    // Update fields
    if (title) course.title = title;
    if (description) course.description = description;
    if (price !== undefined) {
      const priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid number greater than or equal to 0'
        });
      }
      course.price = priceNum;
    }

    // Parse details from form-data or JSON string
    if (details || Object.keys(req.body).some(key => key.startsWith('details.'))) {
      let parsedDetails = {};
      
      // Check if details come as form-data fields
      const detailsKeys = Object.keys(req.body).filter(key => 
        key.startsWith('details.') || key.startsWith('details[')
      );
      
      if (detailsKeys.length > 0) {
        // Build details object from form-data fields
        detailsKeys.forEach(key => {
          let fieldName = key.replace('details.', '').replace('details[', '').replace(']', '');
          
          if (fieldName.endsWith('[]')) {
            fieldName = fieldName.replace('[]', '');
            if (!parsedDetails[fieldName]) {
              parsedDetails[fieldName] = [];
            }
            const arrayValues = Object.keys(req.body)
              .filter(k => k.includes(`[${fieldName}][]`) || k.includes(`.${fieldName}[]`))
              .map(k => req.body[k]);
            parsedDetails[fieldName] = arrayValues.length > 0 ? arrayValues : [req.body[key]];
          } else {
            parsedDetails[fieldName] = req.body[key];
          }
        });
        
        // Handle indexed array fields
        Object.keys(req.body).forEach(key => {
          const match = key.match(/^details\[(\w+)\]\[(\d+)\]$/);
          if (match) {
            const fieldName = match[1];
            if (!parsedDetails[fieldName]) {
              parsedDetails[fieldName] = [];
            }
            const index = parseInt(match[2]);
            parsedDetails[fieldName][index] = req.body[key];
            parsedDetails[fieldName] = parsedDetails[fieldName].filter(val => val !== undefined);
          }
        });
      } else if (details) {
        // Try parsing as JSON string (backward compatibility)
        try {
          parsedDetails = typeof details === 'string' ? JSON.parse(details) : details;
        } catch (e) {
          parsedDetails = typeof details === 'object' ? details : {};
        }
      }

      // Validate level if provided
      if (parsedDetails.level) {
        const validLevels = ['Beginner', 'Intermediate', 'Advanced'];
        if (!validLevels.includes(parsedDetails.level)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid level. Must be Beginner, Intermediate, or Advanced'
          });
        }
      }
      // Merge details object
      course.details = {
        ...course.details,
        ...parsedDetails
      };
    }

    await course.save();

    // Populate course data
    const populatedCourse = await Course.findById(course._id)
      .populate('teacher', 'name email role')
      .populate('students', 'name email');

    // Ensure thumbnail URL is full
    populatedCourse.thumbnail = generateFileUrl(populatedCourse.thumbnail);

    res.json({
      success: true,
      message: 'Course updated successfully',
      course: populatedCourse
    });

  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating course',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Course
const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    await Course.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });

  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting course',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Payments - Removed (payment system removed)
const getAllPayments = async (req, res) => {
  res.json({
    success: true,
    payments: [],
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      pages: 0
    },
    message: 'Payment system has been removed'
  });
};

// Get All Quizzes
const getAllQuizzes = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const quizzes = await Quiz.find(query)
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Quiz.countDocuments(query);

    res.json({
      success: true,
      quizzes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all quizzes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching quizzes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Admin-Created Quizzes (admin only - quizzes created by admins)
const getAdminCreatedQuizzes = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // First, find all admin users
    const adminUsers = await User.find({ role: 'admin' }).select('_id');
    const adminIds = adminUsers.map(admin => admin._id);

    // Build query for quizzes created by admins
    const query = { createdBy: { $in: adminIds } };
    
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const quizzes = await Quiz.find(query)
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Add status and timing information to each quiz
    const quizzesWithStatus = quizzes.map(quiz => {
      const quizObj = quiz.toObject();
      const status = updateQuizStatus(quiz);
      const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
      const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
      
      return {
        ...quizObj,
        status,
        startDateTime,
        endDateTime,
        isActive: status === 'active',
        isScheduled: status === 'scheduled',
        isEnded: status === 'ended',
        isAdminCreated: true // All quizzes here are admin-created
      };
    });

    const total = await Quiz.countDocuments(query);

    res.json({
      success: true,
      quizzes: quizzesWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get admin-created quizzes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching admin-created quizzes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to update quiz status based on timing
const updateQuizStatus = (quiz) => {
  if (!quiz.startDate || !quiz.endDate || !quiz.startTime || !quiz.endTime) {
    return 'invalid';
  }
  
  const now = new Date();
  const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
  const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);
  
  if (now < startDateTime) {
    return 'scheduled';
  } else if (now >= startDateTime && now <= endDateTime) {
    return 'active';
  } else {
    return 'ended';
  }
};

// Create Quiz (admin only - admin can create quizzes like teachers)
const createQuiz = async (req, res) => {
  try {
    const { 
      title, 
      description, 
      questions, 
      startDate, 
      endDate, 
      startTime, 
      endTime, 
      totalDuration,
      level,
      category,
      totalMarks,
      tags,
      price,
      isPaid,
      entryFee,
      prizePool,
      prizeDistribution,
      maxParticipants
    } = req.body;

    // Validate required fields
    if (!title || !questions || !startDate || !endDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Title, questions, startDate, endDate, startTime, and endTime are required.'
      });
    }

    // Validate questions array
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Quiz must contain at least one question.'
      });
    }

    // Validate each question
    for (const q of questions) {
      if (!q.questionText || !q.options || !Array.isArray(q.options) || q.options.length !== 4) {
        return res.status(400).json({
          success: false,
          message: 'Each question must have questionText and exactly 4 options.'
        });
      }
      
      if (q.correctAnswer === undefined || q.correctAnswer < 0 || q.correctAnswer > 3) {
        return res.status(400).json({
          success: false,
          message: 'Each question must have a valid correctAnswer (0-3).'
        });
      }

      if (!q.timeLimit || q.timeLimit < 5) {
        return res.status(400).json({
          success: false,
          message: 'Each question must have a timeLimit of at least 5 seconds.'
        });
      }
    }

    // Validate dates
    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);
    const now = new Date();

    if (startDateTime <= now) {
      return res.status(400).json({
        success: false,
        message: 'Quiz start date and time must be in the future.'
      });
    }

    if (endDateTime <= startDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Quiz end date and time must be after start date and time.'
      });
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({
        success: false,
        message: 'Time must be in HH:MM format (24-hour).'
      });
    }

    // Calculate total duration if not provided
    let calculatedDuration = totalDuration;
    if (!calculatedDuration) {
      const diffInMinutes = Math.ceil((endDateTime - startDateTime) / (1000 * 60));
      calculatedDuration = diffInMinutes;
    }

    // Validate level if provided
    if (level && !['beginner', 'intermediate', 'advanced', 'expert'].includes(level)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid level. Must be beginner, intermediate, advanced, or expert.'
      });
    }

    // Validate paid quiz requirements if isPaid is true
    if (isPaid) {
      if (!entryFee || entryFee <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Entry fee is required for paid quizzes and must be greater than 0.'
        });
      }
      if (!prizePool || prizePool <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Prize pool is required for paid quizzes and must be greater than 0.'
        });
      }
      
      // Validate prize distribution
      if (prizeDistribution) {
        const { first, second, third } = prizeDistribution;
        if (first === undefined || second === undefined || third === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Prize distribution must include first, second, and third place percentages.'
          });
        }
        
        const firstNum = typeof first === 'string' ? parseFloat(first) : first;
        const secondNum = typeof second === 'string' ? parseFloat(second) : second;
        const thirdNum = typeof third === 'string' ? parseFloat(third) : third;
        
        if (isNaN(firstNum) || isNaN(secondNum) || isNaN(thirdNum)) {
          return res.status(400).json({
            success: false,
            message: 'Prize distribution percentages must be valid numbers.'
          });
        }
        
        if (firstNum < 0 || secondNum < 0 || thirdNum < 0) {
          return res.status(400).json({
            success: false,
            message: 'Prize distribution percentages cannot be negative.'
          });
        }
        
        const total = firstNum + secondNum + thirdNum;
        if (Math.abs(total - 100) > 0.01) { // Allow small floating point differences
          return res.status(400).json({
            success: false,
            message: `Prize distribution percentages must add up to 100%. Current total: ${total.toFixed(2)}%`
          });
        }
      }
    }

    // Create quiz
    const quizData = {
      title,
      description,
      questions,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      startTime,
      endTime,
      totalDuration: calculatedDuration,
      createdBy: req.user.userId // Admin's ID
    };

    // Add optional fields if provided
    if (level) quizData.level = level;
    if (category) quizData.category = category;
    if (totalMarks) quizData.totalMarks = totalMarks;
    if (tags && Array.isArray(tags)) quizData.tags = tags;
    if (price !== undefined) {
      const priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (!isNaN(priceNum) && priceNum >= 0) {
        quizData.price = priceNum;
      }
    }

    // Add paid quiz fields (admin can create paid quizzes without permission check)
    if (isPaid) {
      quizData.isPaid = true;
      quizData.entryFee = typeof entryFee === 'string' ? parseFloat(entryFee) : entryFee;
      quizData.prizePool = typeof prizePool === 'string' ? parseFloat(prizePool) : prizePool;
      
      // Set prize distribution
      if (prizeDistribution && prizeDistribution.first !== undefined) {
        quizData.prizeDistribution = {
          first: typeof prizeDistribution.first === 'string' ? parseFloat(prizeDistribution.first) : prizeDistribution.first,
          second: typeof prizeDistribution.second === 'string' ? parseFloat(prizeDistribution.second) : prizeDistribution.second,
          third: typeof prizeDistribution.third === 'string' ? parseFloat(prizeDistribution.third) : prizeDistribution.third
        };
      } else {
        quizData.prizeDistribution = {
          first: 50,
          second: 30,
          third: 20
        };
      }
      
      if (maxParticipants) {
        const maxParticipantsNum = typeof maxParticipants === 'string' ? parseInt(maxParticipants) : maxParticipants;
        if (!isNaN(maxParticipantsNum) && maxParticipantsNum > 0) {
          quizData.maxParticipants = maxParticipantsNum;
        }
      }
    } else {
      quizData.isPaid = false;
      quizData.entryFee = 0;
      quizData.prizePool = 0;
    }

    const quiz = new Quiz(quizData);
    await quiz.save();

    // Populate createdBy
    const populatedQuiz = await Quiz.findById(quiz._id)
      .populate('createdBy', 'name email role');

    res.status(201).json({ 
      success: true,
      message: 'Quiz created successfully', 
      quiz: {
        ...populatedQuiz.toObject(),
        startDateTime: startDateTime,
        endDateTime: endDateTime
      }
    });
  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error creating quiz', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Quiz by ID (admin only)
const getQuizById = async (req, res) => {
  try {
    const { id } = req.params;

    const quiz = await Quiz.findById(id)
      .populate('createdBy', 'name email role');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Add status and timing information
    const quizObj = quiz.toObject();
    const status = updateQuizStatus(quiz);
    const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
    const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);

    const quizWithStatus = {
      ...quizObj,
      status,
      startDateTime,
      endDateTime,
      isActive: status === 'active',
      isScheduled: status === 'scheduled',
      isEnded: status === 'ended'
    };

    res.json({
      success: true,
      quiz: quizWithStatus
    });

  } catch (error) {
    console.error('Get quiz by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Quiz (admin only - admin can update any quiz)
const updateQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      questions,
      startDate,
      endDate,
      startTime,
      endTime,
      totalDuration,
      level,
      category,
      totalMarks,
      tags,
      price,
      isPaid,
      entryFee,
      prizePool,
      prizeDistribution,
      maxParticipants
    } = req.body;

    const quiz = await Quiz.findById(id);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Update fields if provided
    if (title) quiz.title = title;
    if (description !== undefined) quiz.description = description;
    if (level) {
      if (!['beginner', 'intermediate', 'advanced', 'expert'].includes(level)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid level. Must be beginner, intermediate, advanced, or expert.'
        });
      }
      quiz.level = level;
    }
    if (category) quiz.category = category;
    if (totalMarks) quiz.totalMarks = totalMarks;
    if (tags && Array.isArray(tags)) quiz.tags = tags;

    // Update questions if provided
    if (questions && Array.isArray(questions)) {
      // Validate questions
      if (questions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Quiz must contain at least one question.'
        });
      }

      for (const q of questions) {
        if (!q.questionText || !q.options || !Array.isArray(q.options) || q.options.length !== 4) {
          return res.status(400).json({
            success: false,
            message: 'Each question must have questionText and exactly 4 options.'
          });
        }
        
        if (q.correctAnswer === undefined || q.correctAnswer < 0 || q.correctAnswer > 3) {
          return res.status(400).json({
            success: false,
            message: 'Each question must have a valid correctAnswer (0-3).'
          });
        }

        if (!q.timeLimit || q.timeLimit < 5) {
          return res.status(400).json({
            success: false,
            message: 'Each question must have a timeLimit of at least 5 seconds.'
          });
        }
      }

      quiz.questions = questions;
    }

    // Update timing if provided
    if (startDate || startTime || endDate || endTime) {
      const newStartDate = startDate ? new Date(startDate) : quiz.startDate;
      const newEndDate = endDate ? new Date(endDate) : quiz.endDate;
      const newStartTime = startTime || quiz.startTime;
      const newEndTime = endTime || quiz.endTime;

      // Validate time format
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (startTime && !timeRegex.test(startTime)) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be in HH:MM format (24-hour).'
        });
      }
      if (endTime && !timeRegex.test(endTime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be in HH:MM format (24-hour).'
        });
      }

      const startDateTime = new Date(`${newStartDate.toISOString().split('T')[0]}T${newStartTime}`);
      const endDateTime = new Date(`${newEndDate.toISOString().split('T')[0]}T${newEndTime}`);
      const now = new Date();

      if (startDateTime <= now) {
        return res.status(400).json({
          success: false,
          message: 'Quiz start date and time must be in the future.'
        });
      }

      if (endDateTime <= startDateTime) {
        return res.status(400).json({
          success: false,
          message: 'Quiz end date and time must be after start date and time.'
        });
      }

      if (startDate) quiz.startDate = newStartDate;
      if (endDate) quiz.endDate = newEndDate;
      if (startTime) quiz.startTime = newStartTime;
      if (endTime) quiz.endTime = newEndTime;

      // Recalculate duration if timing changed
      if (startDate || startTime || endDate || endTime) {
        const diffInMinutes = Math.ceil((endDateTime - startDateTime) / (1000 * 60));
        quiz.totalDuration = totalDuration || diffInMinutes;
      }
    }

    if (totalDuration) {
      quiz.totalDuration = totalDuration;
    }

    if (price !== undefined) {
      const priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (!isNaN(priceNum) && priceNum >= 0) {
        quiz.price = priceNum;
      }
    }

    // Update paid quiz fields if provided
    if (isPaid !== undefined) {
      quiz.isPaid = isPaid;
      
      if (isPaid) {
        // Validate paid quiz requirements
        if (entryFee !== undefined) {
          const entryFeeNum = typeof entryFee === 'string' ? parseFloat(entryFee) : entryFee;
          if (isNaN(entryFeeNum) || entryFeeNum <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Entry fee must be a valid number greater than 0.'
            });
          }
          quiz.entryFee = entryFeeNum;
        }
        
        if (prizePool !== undefined) {
          const prizePoolNum = typeof prizePool === 'string' ? parseFloat(prizePool) : prizePool;
          if (isNaN(prizePoolNum) || prizePoolNum <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Prize pool must be a valid number greater than 0.'
            });
          }
          quiz.prizePool = prizePoolNum;
        }
        
        if (prizeDistribution) {
          // Validate prize distribution
          const { first, second, third } = prizeDistribution;
          if (first !== undefined && second !== undefined && third !== undefined) {
            const firstNum = typeof first === 'string' ? parseFloat(first) : first;
            const secondNum = typeof second === 'string' ? parseFloat(second) : second;
            const thirdNum = typeof third === 'string' ? parseFloat(third) : third;
            
            if (isNaN(firstNum) || isNaN(secondNum) || isNaN(thirdNum)) {
              return res.status(400).json({
                success: false,
                message: 'Prize distribution percentages must be valid numbers.'
              });
            }
            
            if (firstNum < 0 || secondNum < 0 || thirdNum < 0) {
              return res.status(400).json({
                success: false,
                message: 'Prize distribution percentages cannot be negative.'
              });
            }
            
            const total = firstNum + secondNum + thirdNum;
            if (Math.abs(total - 100) > 0.01) {
              return res.status(400).json({
                success: false,
                message: `Prize distribution percentages must add up to 100%. Current total: ${total.toFixed(2)}%`
              });
            }
            
            quiz.prizeDistribution = {
              first: firstNum,
              second: secondNum,
              third: thirdNum
            };
          }
        }
        
        if (maxParticipants !== undefined) {
          const maxParticipantsNum = typeof maxParticipants === 'string' ? parseInt(maxParticipants) : maxParticipants;
          if (!isNaN(maxParticipantsNum) && maxParticipantsNum > 0) {
            quiz.maxParticipants = maxParticipantsNum;
          } else if (maxParticipantsNum === 0 || maxParticipants === '') {
            quiz.maxParticipants = 0; // Unlimited
          }
        }
      } else {
        // If setting to free, reset paid quiz fields
        quiz.entryFee = 0;
        quiz.prizePool = 0;
        quiz.maxParticipants = 0;
      }
    }

    await quiz.save();

    // Populate createdBy
    const populatedQuiz = await Quiz.findById(quiz._id)
      .populate('createdBy', 'name email role');

    // Add status and timing information
    const quizObj = populatedQuiz.toObject();
    const status = updateQuizStatus(quiz);
    const startDateTime = new Date(`${quiz.startDate.toISOString().split('T')[0]}T${quiz.startTime}`);
    const endDateTime = new Date(`${quiz.endDate.toISOString().split('T')[0]}T${quiz.endTime}`);

    const quizWithStatus = {
      ...quizObj,
      status,
      startDateTime,
      endDateTime,
      isActive: status === 'active',
      isScheduled: status === 'scheduled',
      isEnded: status === 'ended'
    };

    res.json({
      success: true,
      message: 'Quiz updated successfully',
      quiz: quizWithStatus
    });

  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Quiz (admin only - admin can delete any quiz)
const deleteQuiz = async (req, res) => {
  try {
    const { id } = req.params;

    const quiz = await Quiz.findById(id);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Check if quiz is currently active (optional - you might want to prevent deletion of active quizzes)
    const status = updateQuizStatus(quiz);
    if (status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an active quiz. Please wait for it to end.'
      });
    }

    await Quiz.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Quiz deleted successfully',
      deletedQuiz: {
        id: quiz._id,
        title: quiz.title,
        status: status
      }
    });

  } catch (error) {
    console.error('Delete quiz error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Videos
const getAllVideos = async (req, res) => {
  try {
    const { page = 1, limit = 10, contentType, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (contentType) query.contentType = contentType;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const videos = await Video.find(query)
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Video.countDocuments(query);

    // Return ONLY filenames for media (frontend will build base URL)
    const toFilenameOnly = (value) => {
      if (!value) return null;
      let v = String(value).trim();
      if (!v) return null;
      try {
        if (v.startsWith('http://') || v.startsWith('https://')) {
          const u = new URL(v);
          v = u.pathname;
        }
      } catch {}
      v = v.replace(/\\/g, '/');
      const uploadsIdx = v.lastIndexOf('/uploads/');
      if (uploadsIdx !== -1) return v.substring(uploadsIdx + '/uploads/'.length);
      const parts = v.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    };

    const videosWithFilenames = videos.map(video => {
      const videoObj = video.toObject();
      const videoFile = toFilenameOnly(videoObj.videoUrl);
      const thumbFile = toFilenameOnly(videoObj.thumbnailUrl);
      return {
        ...videoObj,
        videoUrl: videoFile,
        thumbnailUrl: thumbFile,
        thumbnail: thumbFile
      };
    });

    res.json({
      success: true,
      videos: videosWithFilenames,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Create Video (Admin can create video for any teacher)
const createVideo = async (req, res) => {
  try {
    const { title, description, category, customCategory, contentType, teacherId } = req.body;
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    if (!teacherId) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID is required'
      });
    }

    // Verify teacher exists
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    if (!videoFile) {
      return res.status(400).json({
        success: false,
        message: 'Video file is required'
      });
    }

    const videoContentType = contentType && ['full', 'reel'].includes(contentType) ? contentType : 'full';

    const newVideo = new Video({
      title,
      description,
      contentType: videoContentType,
      category: category ? (Array.isArray(category) ? category : category.split(',')) : [],
      customCategory,
      // Store ONLY filenames; frontend will build base URL
      videoUrl: videoFile.filename,
      thumbnailUrl: thumbFile ? thumbFile.filename : null,
      uploadedBy: teacherId
    });

    await newVideo.save();

    const videoObj = newVideo.toObject();
    res.status(201).json({
      success: true,
      message: 'Video created successfully',
      video: {
        ...videoObj,
        // Return ONLY filenames; frontend will build base URL
        videoUrl: videoFile.filename,
        thumbnailUrl: thumbFile ? thumbFile.filename : null,
        thumbnail: thumbFile ? thumbFile.filename : null
      }
    });

  } catch (error) {
    console.error('Create video error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Video (Admin can update any video)
const updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, customCategory, contentType, teacherId } = req.body;
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Update fields
    if (title) video.title = title;
    if (description) video.description = description;
    if (contentType && ['full', 'reel'].includes(contentType)) {
      video.contentType = contentType;
    }
    if (category !== undefined) {
      video.category = Array.isArray(category) ? category : category.split(',');
    }
    if (customCategory !== undefined) video.customCategory = customCategory;

    // Update video file if provided
    if (videoFile) {
      video.videoUrl = videoFile.filename;
    }

    // Update thumbnail if provided
    if (thumbFile) {
      video.thumbnailUrl = thumbFile.filename;
    }

    // Update teacher if provided
    if (teacherId) {
      const teacher = await User.findById(teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found'
        });
      }
      video.uploadedBy = teacherId;
    }

    await video.save();

    const videoObj = video.toObject();
    res.json({
      success: true,
      message: 'Video updated successfully',
      video: {
        ...videoObj,
        videoUrl: videoObj.videoUrl,
        thumbnailUrl: videoObj.thumbnailUrl,
        thumbnail: videoObj.thumbnailUrl
      }
    });

  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Video (Admin can delete any video)
const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    await Video.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });

  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Create Admin (One-time setup - protected by secret key)
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, secretKey } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Validate secret key protection (optional but recommended)
    if (process.env.ADMIN_CREATION_SECRET) {
      if (!secretKey || secretKey !== process.env.ADMIN_CREATION_SECRET) {
        return res.status(403).json({
          success: false,
          message: 'Invalid secret key for admin creation. Please provide a valid secret key.'
        });
      }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists (any role)
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.role === 'admin') {
        return res.status(400).json({
          success: false,
          message: 'Admin user already exists with this email'
        });
      } else {
        // If user exists with different role, update to admin
        const hashedPassword = await bcrypt.hash(password, 10);
        existingUser.name = name;
        existingUser.password = hashedPassword;
        existingUser.role = 'admin';
        existingUser.isVerified = true;
        await existingUser.save();

        return res.status(200).json({
          success: true,
          message: 'User role updated to admin successfully',
          admin: {
            id: existingUser._id,
            name: existingUser.name,
            email: existingUser.email,
            role: existingUser.role,
            isVerified: existingUser.isVerified
          }
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user (bypass OTP verification for admin creation)
    const admin = new User({
      name,
      email,
      password: hashedPassword,
      role: 'admin',
      isVerified: true,
      otp: null,
      otpExpires: null,
      forgotPasswordOtp: null,
      forgotPasswordExpiry: null
    });

    await admin.save();

    console.log('✅ Admin user created successfully:', email);

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isVerified: admin.isVerified,
        createdAt: admin.createdAt
      },
      note: 'Please store the credentials securely and change the password after first login.'
    });

  } catch (error) {
    console.error('Create admin error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while creating admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Students (admin only)
const getAllStudents = async (req, res) => {
  try {
    const { verified, page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query - only students
    const query = { role: 'student' };
    if (verified !== undefined) query.isVerified = verified === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const students = await User.find(query)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get financial stats for each student
    const studentsWithStats = await Promise.all(
      students.map(async (student) => {
        // Payment system removed
        const totalSpent = 0;
        const totalPurchases = 0;

        // Get enrolled courses count
        const enrolledCourses = await Course.countDocuments({
          students: student._id
        });

        return {
          ...student.toObject(),
          financialStats: {
            totalSpent,
            totalPurchases,
            enrolledCourses
          }
        };
      })
    );

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      students: studentsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all students error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching students',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Student by ID (admin only)
const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await User.findById(id)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Ensure user is a student
    if (student.role !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'User is not a student'
      });
    }

    res.json({
      success: true,
      student
    });

  } catch (error) {
    console.error('Get student by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching student',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Student (admin only - only for students)
const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, isVerified } = req.body;

    const student = await User.findById(id);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Ensure user is a student
    if (student.role !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for updating students. User is not a student.'
      });
    }

    // Validate email format if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }

      // Check if email already exists (if changing email)
      if (email !== student.email) {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already exists'
          });
        }
      }
    }

    // Update fields (role cannot be changed via this endpoint)
    if (name) student.name = name;
    if (email) student.email = email;
    if (isVerified !== undefined) student.isVerified = isVerified;

    await student.save();

    res.json({
      success: true,
      message: 'Student updated successfully',
      student: {
        id: student._id,
        name: student.name,
        email: student.email,
        role: student.role,
        isVerified: student.isVerified,
        updatedAt: student.updatedAt
      }
    });

  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating student',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Student (admin only - only for students)
const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await User.findById(id);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Ensure user is a student
    if (student.role !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for deleting students. User is not a student.'
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Student deleted successfully'
    });

  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting student',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Teachers (admin only)
const getAllTeachers = async (req, res) => {
  try {
    const { verified, page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query - only teachers
    const query = { role: 'teacher' };
    if (verified !== undefined) query.isVerified = verified === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const teachers = await User.find(query)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get financial stats for each teacher
    const teachersWithStats = await Promise.all(
      teachers.map(async (teacher) => {
        // Get all courses by this teacher
        const teacherCourses = await Course.find({ teacher: teacher._id }).select('_id');
        const courseIds = teacherCourses.map(course => course._id);

        // Payment system removed
        const totalEarnings = 0;

        // Get withdrawals
        const withdrawals = await Withdrawal.find({ userId: teacher._id });
        const totalWithdrawn = withdrawals
          .filter(w => w.status === 'completed')
          .reduce((sum, w) => sum + w.amount, 0);
        const pendingWithdrawals = withdrawals
          .filter(w => w.status === 'pending')
          .reduce((sum, w) => sum + w.amount, 0);
        const totalWithdrawals = withdrawals
          .reduce((sum, w) => sum + w.amount, 0);

        const availableBalance = totalEarnings - totalWithdrawn - pendingWithdrawals;

        return {
          ...teacher.toObject(),
          financialStats: {
            totalEarnings,
            totalWithdrawn,
            pendingWithdrawals,
            totalWithdrawals,
            availableBalance,
            totalSales: payments.length,
            totalCourses: teacherCourses.length
          }
        };
      })
    );

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      teachers: teachersWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching teachers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Teacher by ID (admin only)
const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await User.findById(id)
      .select('-password -otp -otpExpires -forgotPasswordOtp -forgotPasswordExpiry');

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Ensure user is a teacher
    if (teacher.role !== 'teacher') {
      return res.status(400).json({
        success: false,
        message: 'User is not a teacher'
      });
    }

    res.json({
      success: true,
      teacher
    });

  } catch (error) {
    console.error('Get teacher by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching teacher',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Teacher (admin only - only for teachers)
const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, isVerified } = req.body;

    const teacher = await User.findById(id);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Ensure user is a teacher
    if (teacher.role !== 'teacher') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for updating teachers. User is not a teacher.'
      });
    }

    // Validate email format if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }

      // Check if email already exists (if changing email)
      if (email !== teacher.email) {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already exists'
          });
        }
      }
    }

    // Update fields (role cannot be changed via this endpoint)
    if (name) teacher.name = name;
    if (email) teacher.email = email;
    if (isVerified !== undefined) teacher.isVerified = isVerified;

    await teacher.save();

    res.json({
      success: true,
      message: 'Teacher updated successfully',
      teacher: {
        id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role,
        isVerified: teacher.isVerified,
        updatedAt: teacher.updatedAt
      }
    });

  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating teacher',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Teacher (admin only - only for teachers)
const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;

    const teacher = await User.findById(id);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Ensure user is a teacher
    if (teacher.role !== 'teacher') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for deleting teachers. User is not a teacher.'
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Teacher deleted successfully'
    });

  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting teacher',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Quiz Attempts (admin only - get all attempts for a specific quiz)
const getQuizAttempts = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verify quiz exists
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get all attempts for this quiz
    const attempts = await QuizAttempt.find({ quizId })
      .populate('studentId', 'name email')
      .sort({ score: -1, completedAt: 1 }) // Sort by score (highest first), then by completion time
      .skip(skip)
      .limit(parseInt(limit));

    const total = await QuizAttempt.countDocuments({ quizId });

    // Add rank to each attempt
    const attemptsWithRank = attempts.map((attempt, index) => ({
      ...attempt.toObject(),
      rank: skip + index + 1
    }));

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        totalMarks: quiz.totalMarks
      },
      attempts: attemptsWithRank,
      totalParticipants: total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get quiz attempts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching quiz attempts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Quiz Rankings/Leaderboard (admin only - get top performers for a quiz)
const getQuizRankings = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { limit = 100 } = req.query; // Default to top 100

    // Verify quiz exists
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get all attempts sorted by score (highest first) and time (fastest first for same score)
    const rankings = await QuizAttempt.find({ quizId })
      .populate('studentId', 'name email')
      .sort({ score: -1, timeSpent: 1 }) // Higher score first, then faster completion
      .limit(parseInt(limit));

    const total = await QuizAttempt.countDocuments({ quizId });

    // Add rank and additional statistics
    const rankingsWithDetails = rankings.map((attempt, index) => ({
      rank: index + 1,
      studentId: attempt.studentId._id,
      studentName: attempt.studentId.name,
      studentEmail: attempt.studentId.email,
      score: attempt.score,
      marksObtained: attempt.marksObtained,
      totalMarks: attempt.totalMarks,
      correctAnswers: attempt.correctAnswers,
      wrongAnswers: attempt.wrongAnswers,
      totalQuestions: attempt.totalQuestions,
      timeSpent: attempt.timeSpent,
      timeSpentMinutes: Math.round(attempt.timeSpent / 60),
      completedAt: attempt.completedAt,
      accuracy: ((attempt.correctAnswers / attempt.totalQuestions) * 100).toFixed(2)
    }));

    // Calculate statistics
    const avgScore = rankings.length > 0 
      ? (rankings.reduce((sum, a) => sum + a.score, 0) / rankings.length).toFixed(2)
      : 0;
    
    const avgTimeSpent = rankings.length > 0
      ? Math.round(rankings.reduce((sum, a) => sum + a.timeSpent, 0) / rankings.length)
      : 0;

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        totalMarks: quiz.totalMarks,
        totalQuestions: quiz.questions.length
      },
      rankings: rankingsWithDetails,
      statistics: {
        totalParticipants: total,
        averageScore: parseFloat(avgScore),
        averageTimeSpent: avgTimeSpent,
        averageTimeSpentMinutes: Math.round(avgTimeSpent / 60),
        highestScore: rankings.length > 0 ? rankings[0].score : 0,
        lowestScore: rankings.length > 0 ? rankings[rankings.length - 1].score : 0
      }
    });

  } catch (error) {
    console.error('Get quiz rankings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching quiz rankings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Toggle teacher's paid quiz permission
const toggleTeacherPaidQuizPermission = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { canCreatePaidQuiz } = req.body;

    if (typeof canCreatePaidQuiz !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'canCreatePaidQuiz must be a boolean value'
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    if (teacher.role !== 'teacher') {
      return res.status(400).json({
        success: false,
        message: 'User is not a teacher'
      });
    }

    teacher.canCreatePaidQuiz = canCreatePaidQuiz;
    await teacher.save();

    res.status(200).json({
      success: true,
      message: `Paid quiz permission ${canCreatePaidQuiz ? 'enabled' : 'disabled'} for teacher`,
      data: {
        teacherId: teacher._id,
        name: teacher.name,
        email: teacher.email,
        canCreatePaidQuiz: teacher.canCreatePaidQuiz
      }
    });
  } catch (error) {
    console.error('Toggle paid quiz permission error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating permission',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all teachers with their paid quiz permission status
const getTeachersPaidQuizStatus = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', isVerified: true })
      .select('name email canCreatePaidQuiz createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: teachers.length,
      data: teachers
    });
  } catch (error) {
    console.error('Get teachers paid quiz status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching teachers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get All Withdrawals (admin only)
const getAllWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, userId, paymentMethod } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    const withdrawals = await Withdrawal.find(query)
      .populate('userId', 'name email role')
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Withdrawal.countDocuments(query);

    res.json({
      success: true,
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get all withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching withdrawals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Approve Withdrawal (admin only)
const approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.userId;

    const withdrawal = await Withdrawal.findById(id)
      .populate('userId', 'name email role');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Withdrawal request is already ${withdrawal.status}. Only pending withdrawals can be approved.`
      });
    }

    // Update withdrawal status
    withdrawal.status = 'approved';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();

    await withdrawal.save();

    // Update admin notification status
    try {
      await AdminNotification.updateMany(
        { 
          type: 'withdrawal',
          'data.withdrawalId': withdrawal._id.toString(),
          status: { $ne: 'actioned' }
        },
        { 
          status: 'actioned',
          handledBy: adminId,
          handledAt: new Date(),
          actionTaken: 'approved'
        }
      );
    } catch (adminNotifError) {
      console.error('Error updating admin notification:', adminNotifError);
    }

    // Send notification to user
    try {
      await createNotification({
        recipientId: withdrawal.userId._id,
        recipientRole: withdrawal.userId.role,
        type: 'system',
        title: 'Withdrawal Request Approved',
        message: `Your withdrawal request of ₹${withdrawal.amount} has been approved. The amount will be processed and sent to your account within 48-72 hours.`,
        fromUserId: adminId,
        data: {
          withdrawalId: withdrawal._id.toString(),
          withdrawalAmount: withdrawal.amount,
          paymentMethod: withdrawal.paymentMethod
        }
      });
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Withdrawal request approved successfully',
      withdrawal
    });

  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while approving withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reject Withdrawal (admin only)
const rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.user.userId;

    const withdrawal = await Withdrawal.findById(id)
      .populate('userId', 'name email role');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Withdrawal request is already ${withdrawal.status}. Only pending withdrawals can be rejected.`
      });
    }

    // Update withdrawal status
    withdrawal.status = 'rejected';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    if (rejectionReason) {
      withdrawal.rejectionReason = rejectionReason;
    }

    await withdrawal.save();

    // Update admin notification status
    try {
      await AdminNotification.updateMany(
        { 
          type: 'withdrawal',
          'data.withdrawalId': withdrawal._id.toString(),
          status: { $ne: 'actioned' }
        },
        { 
          status: 'actioned',
          handledBy: adminId,
          handledAt: new Date(),
          actionTaken: 'rejected',
          actionNote: rejectionReason || 'Rejected by admin'
        }
      );
    } catch (adminNotifError) {
      console.error('Error updating admin notification:', adminNotifError);
    }

    // Send notification to user
    try {
      await createNotification({
        recipientId: withdrawal.userId._id,
        recipientRole: withdrawal.userId.role,
        type: 'system',
        title: 'Withdrawal Request Rejected',
        message: `Your withdrawal request of ₹${withdrawal.amount} has been rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        fromUserId: adminId,
        data: {
          withdrawalId: withdrawal._id.toString(),
          withdrawalAmount: withdrawal.amount,
          rejectionReason: rejectionReason || 'No reason provided'
        }
      });
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Withdrawal request rejected successfully',
      withdrawal
    });

  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while rejecting withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Complete Withdrawal (admin only - mark as completed after payment is sent)
const completeWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionId, remarks } = req.body;
    const adminId = req.user.userId;

    const withdrawal = await Withdrawal.findById(id)
      .populate('userId', 'name email role');

    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    if (withdrawal.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Withdrawal request must be approved before it can be completed. Current status: ${withdrawal.status}`
      });
    }

    // Update withdrawal status
    withdrawal.status = 'completed';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    if (transactionId) {
      withdrawal.transactionId = transactionId;
    }
    if (remarks) {
      withdrawal.remarks = remarks;
    }

    await withdrawal.save();

    // Update admin notification status (if not already actioned)
    try {
      await AdminNotification.updateMany(
        { 
          type: 'withdrawal',
          'data.withdrawalId': withdrawal._id.toString(),
          status: { $ne: 'actioned' }
        },
        { 
          status: 'actioned',
          handledBy: adminId,
          handledAt: new Date(),
          actionTaken: 'approved',
          actionNote: remarks || (transactionId ? `Transaction ID: ${transactionId}` : 'Completed')
        }
      );
    } catch (adminNotifError) {
      console.error('Error updating admin notification:', adminNotifError);
    }

    // Send notification to user
    try {
      await createNotification({
        recipientId: withdrawal.userId._id,
        recipientRole: withdrawal.userId.role,
        type: 'system',
        title: 'Withdrawal Completed',
        message: `Your withdrawal of ₹${withdrawal.amount} has been processed and sent to your ${withdrawal.paymentMethod === 'bank_transfer' ? 'bank account' : withdrawal.paymentMethod === 'upi' ? 'UPI ID' : 'Paytm account'}.${transactionId ? ` Transaction ID: ${transactionId}` : ''}`,
        fromUserId: adminId,
        data: {
          withdrawalId: withdrawal._id.toString(),
          withdrawalAmount: withdrawal.amount,
          transactionId: transactionId || null
        }
      });
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Withdrawal marked as completed successfully',
      withdrawal
    });

  } catch (error) {
    console.error('Complete withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while completing withdrawal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default {
  adminLogin,
  createAdmin,
  getDashboardStats,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
  getAllCourses,
  getAdminCreatedCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getAllPayments,
  getAllQuizzes,
  getAdminCreatedQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  getAllVideos,
  createVideo,
  updateVideo,
  deleteVideo,
  getQuizAttempts,
  getQuizRankings,
  toggleTeacherPaidQuizPermission,
  getTeachersPaidQuizStatus,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal
};

