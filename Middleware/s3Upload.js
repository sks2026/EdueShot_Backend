// Middleware/s3Upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToS3, isS3Enabled } from '../services/s3Service.js';

// Get absolute uploads directory path (for fallback when S3 is disabled)
const uploadsDir = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists (for fallback)
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory (fallback):', uploadsDir);
}

// Memory storage for S3 uploads (files are kept in memory, then uploaded to S3)
const memoryStorage = multer.memoryStorage();

// Disk storage for local fallback
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('📁 Multer destination called for file:', file.originalname);
    console.log('📁 Saving to local directory (S3 disabled):', uploadsDir);
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const filename = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    console.log('📝 Generated filename:', filename);
    cb(null, filename);
  }
});

// Choose storage based on S3 configuration
// When S3 is enabled, use memoryStorage (files stay in memory before S3 upload)
// When S3 is disabled, use diskStorage (files saved to local uploads folder)
const isS3Active = isS3Enabled();
const storage = isS3Active ? memoryStorage : diskStorage;

// Log storage configuration on startup
if (isS3Active) {
  console.log('✅ S3 enabled, using memoryStorage for uploads');
  console.log('📤 Files will be uploaded to AWS S3');
} else {
  console.log('ℹ️ S3 disabled, using local storage');
  console.log('📁 Files will be saved to:', uploadsDir);
}

// File filter for videos & images
const fileFilter = (req, file, cb) => {
  console.log('🔍 File filter checking:', file.originalname, 'Field:', file.fieldname, 'Mimetype:', file.mimetype);
  const allowedExtensions = /mp4|mov|avi|jpg|jpeg|png|gif|webp/;
  const allowedMimetypes = /image\/(jpeg|jpg|png|gif|webp)|video\/(mp4|avi|mov|quicktime)/;
  const ext = path.extname(file.originalname).toLowerCase();
  console.log('📄 File extension:', ext, 'Mimetype:', file.mimetype);
  
  // Check either extension or mimetype
  if (allowedExtensions.test(ext) || allowedMimetypes.test(file.mimetype)) {
    console.log('✅ File accepted');
    cb(null, true);
  } else {
    console.log('❌ File rejected - invalid extension/mimetype');
    cb(new Error('Only video/image files allowed!'));
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  limits: { fileSize: Number.MAX_SAFE_INTEGER }, // No practical limit for full videos
  fileFilter: fileFilter
});

// Middleware to upload files to S3 after multer processes them
const uploadToS3Middleware = async (req, res, next) => {
  // If S3 is not enabled, skip this middleware (files are already saved locally)
  if (!isS3Enabled()) {
    console.log('ℹ️ S3 disabled, using local storage');
    return next();
  }

  console.log('📤 S3 enabled, uploading to S3');
  
  try {
    // Process files from req.files (for fields) or req.file (for single)
    const filesToUpload = [];

    if (req.files) {
      // Handle multiple fields
      Object.keys(req.files).forEach(fieldName => {
        const fieldFiles = Array.isArray(req.files[fieldName]) 
          ? req.files[fieldName] 
          : [req.files[fieldName]];
        
        fieldFiles.forEach(file => {
          if (file) {
            filesToUpload.push({
              field: fieldName,
              buffer: file.buffer,
              originalname: file.originalname,
              mimetype: file.mimetype,
            });
          }
        });
      });
    } else if (req.file) {
      // Handle single file
      filesToUpload.push({
        field: req.file.fieldname,
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      });
    }

    // Upload each file to S3
    for (const fileData of filesToUpload) {
      // Generate filename (without prefix - prefix will be added in uploadToS3)
      const fileName = `${Date.now()}-${fileData.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      
      console.log(`📤 Uploading ${fileData.field} to S3`);
      console.log(`📄 Original filename: ${fileData.originalname}`);
      console.log(`📝 Generated filename: ${fileName}`);
      
      const uploadResult = await uploadToS3(
        fileData.buffer,
        fileName, // Pass filename without prefix
        fileData.mimetype
      );

      // Store S3 URL and key in request object for use in controllers
      // Note: uploadResult.key contains the full S3 key with prefix (e.g., "uploads/filename.mp4")
      if (req.files && req.files[fileData.field]) {
        const fieldFiles = Array.isArray(req.files[fileData.field]) 
          ? req.files[fileData.field] 
          : [req.files[fileData.field]];
        
        fieldFiles.forEach(file => {
          if (file.originalname === fileData.originalname) {
            // Store the full S3 key (with prefix) as filename for database storage
            file.filename = uploadResult.key; // Full S3 key: "uploads/filename.mp4"
            file.s3Url = uploadResult.url; // Store S3 URL
            file.location = uploadResult.url; // For compatibility
            file.s3Key = uploadResult.key; // Explicit S3 key
          }
        });
      } else if (req.file && req.file.originalname === fileData.originalname) {
        req.file.filename = uploadResult.key; // Full S3 key: "uploads/filename.mp4"
        req.file.s3Url = uploadResult.url;
        req.file.location = uploadResult.url;
        req.file.s3Key = uploadResult.key; // Explicit S3 key
      }
    }

    console.log('✅ All files uploaded to S3 successfully');
    next();
  } catch (error) {
    console.error('❌ Error uploading to S3:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload file to S3',
      message: error.message
    });
  }
};

// If you need both video + thumbnail in single request
const videoUpload = [upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), uploadToS3Middleware];

// Single image upload (for course thumbnails, etc.)
const imageUpload = [upload.single('thumbnail'), uploadToS3Middleware];

// Multiple fields upload for course creation (thumbnail + other data)
const courseUpload = [upload.fields([
  { name: 'thumbnail', maxCount: 1 }
]), uploadToS3Middleware];

// Profile picture upload
const profilePicUpload = [upload.single('profilePic'), uploadToS3Middleware];

// Teacher verification documents upload
const verificationDocsUpload = [upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 }
]), uploadToS3Middleware];

// Student verification documents upload
const studentVerificationDocsUpload = [upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'studentId', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 }
]), uploadToS3Middleware];

// Error handling middleware for multer
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false,
        error: 'File too large. Please try again or contact support.' 
      });
    }
    return res.status(400).json({ 
      success: false,
      error: err.message 
    });
  } else if (err) {
    return res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }
  next();
};

export { 
  videoUpload, 
  imageUpload, 
  courseUpload, 
  profilePicUpload, 
  verificationDocsUpload, 
  studentVerificationDocsUpload, 
  handleUploadError, 
  upload,
  uploadToS3Middleware
};

