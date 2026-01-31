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
import s3Routes from './routes/s3Routes.js';
import { apiLimiter } from './Middleware/rateLimiter.js';
import { getMyCourses } from './controllers/courseController.js';
import authenticateToken from './Middleware/userAuth.js';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Check S3 configuration status
import('./services/s3Service.js').then(({ isS3Enabled }) => {
  const s3Status = isS3Enabled();
  if (s3Status) {
    console.log('✅ S3 enabled - Files will be uploaded to AWS S3');
    if (process.env.S3_ENABLED === "true") {
      console.log('   (Enabled via S3_ENABLED=true)');
    }
    if (process.env.STORAGE_TYPE === "s3") {
      console.log('   (Enabled via STORAGE_TYPE=s3)');
    }
  } else {
    console.log('ℹ️ S3 disabled - Files will be saved to local storage');
    if (process.env.S3_ENABLED === "true" || process.env.STORAGE_TYPE === "s3") {
      console.warn('⚠️ S3 flag/type is set but AWS credentials are missing or incomplete');
    }
  }
}).catch(() => {
  console.log('ℹ️ S3 disabled - Files will be saved to local storage');
});

// Ensure uploads directory exists (for local storage fallback)
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
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
// NOTE: When S3 is enabled, files are stored in S3 and should be accessed via signed URLs
app.use('/uploads', async (req, res, next) => {
  // Check if S3 is enabled
  const { isS3Enabled } = await import('./services/s3Service.js');
  
  if (isS3Enabled()) {
    // S3 is enabled - files should be accessed via signed URLs, not direct local access
    console.log('⚠️ S3 enabled - Direct file access blocked. Use signed URLs instead.');
    console.log('📝 Requested file:', req.url);
    return res.status(403).json({
      success: false,
      error: 'Files are stored in S3. Please use signed URLs to access them.',
      message: 'This file is stored in AWS S3. Use the /api/s3/signed-url endpoint to get a signed URL.',
      requestedPath: req.url
    });
  }
  
  // S3 is disabled - serve from local storage
  const filename = decodeURIComponent(req.url.substring(1)); // Remove leading slash and decode URL
  console.log('🎯 Requested file (local storage):', filename);
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
app.get('/debug/uploads', async (req, res) => {
  // Check if S3 is enabled
  const { isS3Enabled } = await import('./services/s3Service.js');
  
  if (isS3Enabled()) {
    return res.json({
      success: false,
      error: 'S3 is enabled - files are stored in S3, not local storage',
      message: 'Files are stored in AWS S3. Use S3 console or API to list files.',
      s3Bucket: process.env.AWS_S3_BUCKET_NAME || 'Not configured'
    });
  }
  
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
app.use('/api/s3', s3Routes);

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