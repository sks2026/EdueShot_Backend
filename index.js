import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import userRoutes from './routes/userRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import quizRoutes from './routes/quizRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import playlistRoutes from './routes/playlistRoute.js';
import adminRoutes from './routes/adminRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import teacherVerificationRoutes from './routes/teacherVerificationRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import { apiLimiter } from './Middleware/rateLimiter.js';
import { getMyCourses } from './controllers/courseController.js';
import authenticateToken from './Middleware/userAuth.js';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadsDir);
} else {
  console.log('📁 Uploads directory exists:', uploadsDir);
  // List files count on startup
  const files = fs.readdirSync(uploadsDir);
  console.log(`📂 Found ${files.length} files in uploads directory`);
}

const app = express();
const PORT = process.env.PORT || 3002;
const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/edu-spark';

// Allowed origins for CORS
const allowedOrigins = [
  'https://eduspark-admin.vercel.app',
  'http://localhost:3000',
  'http://localhost:8081',
  'exp://192.168.1.1:8081' // For Expo development
];

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS middleware
app.use(cors({
  credentials: true,
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('exp://')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now (mobile app compatibility)
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// Serve static files from public directory
app.use(express.static('public'));

// Serve uploaded files from uploads directory with proper URL encoding handling
app.use('/uploads', (req, res, next) => {
  const filename = decodeURIComponent(req.url.substring(1)); // Remove leading slash and decode URL
  console.log('🎯 Requested file:', filename);
  console.log('🔍 Original URL:', req.url);
  
  
  
  // Construct file path
  const filePath = path.join(process.cwd(), 'uploads', filename);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error('❌ File not found:', filePath);
    return res.status(404).json({ 
      success: false, 
      error: 'File not found',
      requestedPath: filename 
    });
  }
  
  // Get file stats
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  // Set appropriate headers based on file type
  const fileExtension = path.extname(filename).toLowerCase();
  
  if (fileExtension === '.mp4' || fileExtension === '.avi' || fileExtension === '.mov') {
    // Video file handling with range requests
    if (range) {
      // Partial content request (for video seeking)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
      });
      file.pipe(res);
    } else {
      // Full video request
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Accept-Ranges'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } else if (fileExtension === '.jpg' || fileExtension === '.png' || fileExtension === '.jpeg') {
    // Image file handling
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': `image/${fileExtension.substring(1)}`,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // Generic file handling
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Debug endpoint for file access
app.get('/debug/file/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
 
  
  console.log('🔍 Debug request for file:', filename);
  
  const filePath = path.join(process.cwd(), 'uploads', filename);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    // List all files in uploads directory to help debug
    const files = fs.readdirSync(path.join(process.cwd(), 'uploads'));
    console.log('📂 Available files in uploads:', files);
    
    return res.json({
      success: false,
      error: 'File not found',
      requestedFile: filename,
      availableFiles: files.slice(0, 10), // Show first 10 files
      totalFiles: files.length
    });
  }
  
  const stat = fs.statSync(filePath);
  
  res.json({
    success: true,
    filename: filename,
    filePath: filePath,
    size: stat.size,
    modified: stat.mtime,
    directUrl: `http://localhost:3002/uploads/${encodeURIComponent(filename)}`
  });
});

// Debug endpoint to list all uploads
app.get('/debug/uploads', (req, res) => {
  const uploadsDir = path.join(process.cwd(), 'uploads');

  console.log('🔍 Debug uploads request');
  console.log('📁 Current working directory:', process.cwd());
  console.log('📁 Uploads directory:', uploadsDir);

  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({
        success: false,
        error: 'Uploads directory does not exist',
        cwd: process.cwd(),
        uploadsDir: uploadsDir
      });
    }

    const files = fs.readdirSync(uploadsDir);
    const fileDetails = files.map(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        created: stats.birthtime,
        url: `http://192.168.31.186:3002/uploads/${file}`
      };
    });

    res.json({
      success: true,
      cwd: process.cwd(),
      uploadsDir: uploadsDir,
      totalFiles: files.length,
      files: fileDetails.slice(-20) // Last 20 files
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      cwd: process.cwd(),
      uploadsDir: uploadsDir
    });
  }
});

// EXPLICIT route for teacher's courses - BEFORE courseRoutes to avoid conflict
app.get('/api/courses/my-courses', authenticateToken, getMyCourses);

// Routes
app.use('/api/users', userRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/verification', teacherVerificationRoutes);
app.use('/api/support', supportRoutes);

// Basic route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Edu-Spark API is running!',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      register: 'POST /api/users/register',
      login: 'POST /api/users/login',
      profile: 'GET /api/users/profile',
      quizzes: '/api/quizzes',
      videos: '/api/videos',
      courses: '/api/courses',
      playlists: '/api/playlists',
      admin: '/api/admin'
    }
  });
});

// Database connection with better error handling
const connectDB = async () => {
  try {
    if (!dbURI) {
      console.error('MONGODB_URI is not defined in environment variables');
      process.exit(1);
    }
    
    await mongoose.connect(dbURI);
    console.log('Connected to MongoDB successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// Start server
app.listen(PORT,"0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}`);
    console.log(`Users API: http://localhost:${PORT}/api/users`);
});

export default app;