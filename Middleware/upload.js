// middleware/upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Get absolute uploads directory path
const uploadsDir = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadsDir);
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('📁 Multer destination called for file:', file.originalname);
    console.log('📁 Saving to directory:', uploadsDir);
    cb(null, uploadsDir); // Use absolute path
  },
  filename: (req, file, cb) => {
    const filename = Date.now() + '-' + file.originalname;
    console.log('📝 Generated filename:', filename);
    console.log('📝 Full path will be:', path.join(uploadsDir, filename));
    cb(null, filename);
  }
});

// File filter for videos & images
// No file size limit for full videos - set to maximum safe integer
const upload = multer({
  storage: storage,
  limits: { fileSize: Number.MAX_SAFE_INTEGER }, // No practical limit for full videos
  fileFilter: (req, file, cb) => {
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
  }
});

// If you need both video + thumbnail in single request
const videoUpload = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

// Single image upload (for course thumbnails, etc.)
const imageUpload = upload.single('thumbnail');

// Multiple fields upload for course creation (thumbnail + other data)
const courseUpload = upload.fields([
  { name: 'thumbnail', maxCount: 1 }
]);

// Profile picture upload
const profilePicUpload = upload.single('profilePic');

// Teacher verification documents upload
const verificationDocsUpload = upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 }
]);

// Student verification documents upload
const studentVerificationDocsUpload = upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'studentId', maxCount: 1 },
  { name: 'marksheet', maxCount: 1 }
]);

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

export { videoUpload, imageUpload, courseUpload, profilePicUpload, verificationDocsUpload, studentVerificationDocsUpload, handleUploadError, upload };
