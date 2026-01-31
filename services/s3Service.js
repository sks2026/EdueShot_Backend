// services/s3Service.js
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

// Initialize S3 client from environment variables
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const BUCKET_REGION = process.env.AWS_REGION || 'us-east-1';

// Get upload prefix from environment variable, default to "uploads/"
// Ensures prefix ends with "/" for proper S3 key structure
const getUploadPrefix = () => {
  const prefix = process.env.AWS_S3_UPLOAD_PREFIX || 'uploads/';
  return prefix.endsWith('/') ? prefix : prefix + '/';
};

// Check if S3 is enabled
// Supports both S3_ENABLED=true and STORAGE_TYPE=s3
// First check flags, then verify credentials are present
const isS3Enabled = () => {
  // Check if S3 is enabled via S3_ENABLED flag or STORAGE_TYPE
  const s3EnabledFlag = process.env.S3_ENABLED === "true";
  const storageTypeS3 = process.env.STORAGE_TYPE === "s3";
  const s3Requested = s3EnabledFlag || storageTypeS3;
  
  // Verify all required credentials are present
  const hasCredentials = !!(
    process.env.AWS_S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );
  
  // S3 is enabled only if flag/type is set AND credentials are present
  const enabled = s3Requested && hasCredentials;
  
  if (s3Requested && !hasCredentials) {
    if (s3EnabledFlag) {
      console.warn('⚠️ S3_ENABLED is true but AWS credentials are missing. S3 will be disabled.');
    }
    if (storageTypeS3) {
      console.warn('⚠️ STORAGE_TYPE=s3 but AWS credentials are missing. S3 will be disabled.');
    }
  }
  
  return enabled;
};

// Upload file to S3
const uploadToS3 = async (fileBuffer, fileName, contentType) => {
  if (!isS3Enabled()) {
    throw new Error('S3 is not enabled. Set S3_ENABLED=true in .env file and provide AWS credentials.');
  }

  try {
    // Get upload prefix and construct full S3 key
    const uploadPrefix = getUploadPrefix();
    const s3Key = uploadPrefix + fileName;
    
    console.log('📤 S3 enabled, uploading to S3');
    console.log('📁 S3 Key:', s3Key);
    console.log('📄 Filename:', fileName);
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key, // Use full key with prefix
      Body: fileBuffer,
      ContentType: contentType,
      // ACL removed - bucket uses "Bucket owner enforced" (ACLs disabled)
      // Files are private by default and can be accessed via bucket policy or signed URLs
    });

    await s3Client.send(command);
    
    // Generate S3 URL (files are private by default with bucket owner enforced)
    // For public access, configure bucket policy or use signed URLs
    const s3Url = `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${s3Key}`;
    
    console.log('✅ File uploaded to S3 successfully');
    console.log('🔑 S3 Key:', s3Key);
    console.log('🔗 S3 URL:', s3Url);
    console.log('ℹ️ File is private (bucket owner enforced). Use bucket policy or signed URLs for public access.');
    
    return {
      success: true,
      fileName,
      s3Key: s3Key, // Return full S3 key with prefix
      url: s3Url, // S3 URL (file is private, use bucket policy for public access)
      key: s3Key, // For backward compatibility, return full key
    };
  } catch (error) {
    console.error('❌ S3 upload error:', error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

// Get signed URL for private files
// fileName can be either just the filename or full S3 key (with prefix)
// expiresIn: expiration time in seconds (default: 600 for videos, 3600 for thumbnails)
const getSignedGetUrl = async (key, expiresInSeconds = 600) => {
  if (!isS3Enabled()) {
    throw new Error('S3 is not configured.');
  }

  try {
    // If key already contains the prefix, use it as-is
    // Otherwise, add the prefix
    const uploadPrefix = getUploadPrefix();
    const s3Key = key.startsWith(uploadPrefix) ? key : uploadPrefix + key;
    
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    
    // Calculate expiry timestamp (current time + expiry seconds)
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    
    console.log(`🔐 Generated signed URL for key: ${s3Key}, expires in: ${expiresInSeconds}s (${expiresAt.toISOString()})`);
    
    // Return object with URL and expiry info for frontend auto-refresh
    return {
      url: signedUrl,
      expiresAt: expiresAt.toISOString(),
      expiresIn: expiresInSeconds
    };
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }
};

// Helper to get signed URL for video
// Course videos aur long videos ke liye 7 days (AWS maximum)
// Students ko videos complete karne ke liye enough time chahiye
// Jab tak video delete nahi hoti, tab tak accessible rahegi (7 days expiry, frontend auto-refresh karega)
const getSignedVideoUrl = async (key) => {
  return getSignedGetUrl(key, 604800); // 7 days (604800 seconds) - AWS maximum
};

// Helper to get signed URL for thumbnail (60 minutes default)
const getSignedThumbnailUrl = async (key) => {
  return getSignedGetUrl(key, 3600); // 60 minutes
};

// Backward compatibility alias
const getSignedUrlForFile = getSignedGetUrl;

// Delete file from S3
// fileName can be either just the filename or full S3 key (with prefix)
const deleteFromS3 = async (fileName) => {
  if (!isS3Enabled()) {
    console.warn('⚠️ S3 not enabled, skipping delete');
    return { success: true };
  }

  try {
    // If fileName already contains the prefix, use it as-is
    // Otherwise, add the prefix
    const uploadPrefix = getUploadPrefix();
    const s3Key = fileName.startsWith(uploadPrefix) ? fileName : uploadPrefix + fileName;
    
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);
    console.log('✅ File deleted from S3:', s3Key);
    return { success: true };
  } catch (error) {
    console.error('❌ S3 delete error:', error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
};

// Generate public URL for S3 file
// fileName can be either just the filename or full S3 key (with prefix)
const getS3PublicUrl = (fileName) => {
  if (!isS3Enabled()) {
    return null;
  }

  // If fileName already contains the prefix, use it as-is
  // Otherwise, add the prefix
  const uploadPrefix = getUploadPrefix();
  const s3Key = fileName.startsWith(uploadPrefix) ? fileName : uploadPrefix + fileName;

  // Use CloudFront URL if configured, otherwise use S3 URL
  if (process.env.AWS_CLOUDFRONT_URL) {
    return `${process.env.AWS_CLOUDFRONT_URL}/${s3Key}`;
  }

  return `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${s3Key}`;
};

// Extract filename from S3 URL or local path
const extractFileName = (urlOrPath) => {
  if (!urlOrPath) return null;
  
  // If it's an S3 URL, extract the key
  if (urlOrPath.includes('.s3.') || urlOrPath.includes('amazonaws.com/')) {
    const parts = urlOrPath.split('/');
    return parts[parts.length - 1];
  }
  
  // If it's a CloudFront URL
  if (process.env.AWS_CLOUDFRONT_URL && urlOrPath.startsWith(process.env.AWS_CLOUDFRONT_URL)) {
    return urlOrPath.replace(process.env.AWS_CLOUDFRONT_URL + '/', '');
  }
  
  // If it's a local path, extract filename
  const parts = urlOrPath.split('/');
  return parts[parts.length - 1];
};

export {
  s3Client,
  uploadToS3,
  getSignedGetUrl,
  getSignedVideoUrl,
  getSignedThumbnailUrl,
  getSignedUrlForFile, // Keep for backward compatibility
  deleteFromS3,
  getS3PublicUrl,
  extractFileName,
  isS3Enabled,
  getUploadPrefix,
  BUCKET_NAME,
  BUCKET_REGION,
};

