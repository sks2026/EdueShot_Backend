import Video from '../Models/videoModel.js';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffprobe from 'ffprobe-static';
import { getS3PublicUrl, extractFileName, isS3Enabled, getUploadPrefix, getSignedVideoUrl, getSignedThumbnailUrl } from '../services/s3Service.js';

// Set ffprobe path
ffmpeg.setFfprobePath(ffprobe.path);

// Helper function to get video duration in seconds
const getVideoDuration = (videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error('Error getting video duration:', err);
        reject(err);
      } else {
        const duration = metadata.format.duration;
        console.log(`Video duration: ${duration} seconds`);
        resolve(duration);
      }
    });
  });
};

// Helper function to generate full URL for uploaded files
const generateFileUrl = (filename) => {
  // If S3 is enabled, use S3 URL
  if (isS3Enabled()) {
    const s3Url = getS3PublicUrl(filename);
    if (s3Url) {
      return s3Url;
    }
  }
  
  // Fallback to local server URL
  const defaultUrl = 'http://192.168.31.186:3002';
  let baseUrl = process.env.BASE_URL || defaultUrl;
  
  // Ensure BASE_URL has proper protocol
  if (baseUrl && !baseUrl.startsWith('http')) {
    console.warn('⚠️ Invalid BASE_URL in .env:', baseUrl, '- using default');
    baseUrl = defaultUrl;
  }
  
  return `${baseUrl}/uploads/${filename}`;
};

// Convert stored/received media URL/path to ONLY filename.
// Examples:
// - "http://host:3002/uploads/a.jpg" -> "a.jpg"
// - "https://bucket.s3.region.amazonaws.com/a.jpg" -> "a.jpg"
// - "/uploads/a.jpg" -> "a.jpg"
// - "uploads/a.jpg" -> "a.jpg"
// - "a.jpg" -> "a.jpg"
const toFilenameOnly = (value) => {
  if (!value) return null;
  let v = String(value).trim();
  if (!v) return null;

  // If S3 is enabled, try to extract filename from S3 URL
  if (isS3Enabled()) {
    const extracted = extractFileName(v);
    if (extracted) {
      return extracted;
    }
  }

  // If it's a full URL, parse and take pathname
  try {
    if (v.startsWith('http://') || v.startsWith('https://')) {
      const u = new URL(v);
      v = u.pathname; // "/uploads/a.jpg" or "/filename.jpg"
    }
  } catch {
    // ignore parse errors
  }

  v = v.replace(/\\/g, '/');
  const uploadsIdx = v.lastIndexOf('/uploads/');
  if (uploadsIdx !== -1) return v.substring(uploadsIdx + '/uploads/'.length);

  const parts = v.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};

// Helper function to ensure URL is full (for backward compatibility)
const ensureFullUrl = (url) => {
  try {
    if (!url) return null;
    
    // Default base URL
    const defaultUrl = 'http://192.168.31.186:3002';
    
    // Check if already full URL with proper protocol
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Fix localhost references
      let fixedUrl = url.replace(/localhost/gi, '192.168.31.186');
      fixedUrl = fixedUrl.replace(/127\.0\.0\.1/gi, '192.168.31.186');
      return fixedUrl;
    }
    
    // Handle /uploads/ prefix
    if (url.startsWith('/uploads/')) {
      const filename = url.replace('/uploads/', '');
      return generateFileUrl(filename);
    }
    
    // Handle relative paths or just filenames
    return generateFileUrl(url);
  } catch (error) {
    console.warn('⚠️ Error in ensureFullUrl:', error.message, 'for URL:', url);
    return null;
  }
};

const uploadVideo = async (req, res) => {
  try {
    debugger;
    console.log('Upload video request received:', req.body);
    
    // Multer stores files in req.files
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    console.log('🎥 Video file:', videoFile ? {
      filename: videoFile.filename,
      originalname: videoFile.originalname,
      mimetype: videoFile.mimetype,
      size: videoFile.size
    } : 'No video file');
    console.log('🖼️ Thumbnail file:', thumbFile ? {
      filename: thumbFile.filename,
      originalname: thumbFile.originalname,
      mimetype: thumbFile.mimetype,
      size: thumbFile.size
    } : 'No thumbnail file');

    if (!videoFile) {
      console.log('❌ No video file found');
      return res.status(400).json({ error: 'Video file is required' });
    }

    const { title, description, category, customCategory } = req.body;

    console.log('📋 Video data:', { title, description, category, customCategory });

    // Get video duration - handle both S3 and local files
    let videoDuration = null;
    
    if (isS3Enabled() && videoFile.s3Url) {
      // For S3 files, we can't easily get duration without downloading
      // Duration can be extracted on frontend or set to null
      console.log('ℹ️ S3 file detected, skipping duration extraction (can be done on frontend)');
    } else {
      // For local files, extract duration
      try {
        const videoPath = path.join(process.cwd(), 'uploads', videoFile.filename);
        videoDuration = await getVideoDuration(videoPath);
        console.log(`📏 Video duration: ${videoDuration}s`);
      } catch (durationError) {
        console.warn('⚠️ Could not determine video duration:', durationError.message);
      }
    }

    // Use contentType from request body, default to 'full' if not provided
    const requestContentType = req.body.contentType;
    const contentType = requestContentType && ['full', 'reel'].includes(requestContentType) ? requestContentType : 'full';
    console.log(`📹 Content type from request: ${requestContentType}, Using: ${contentType}`);

    // Get file identifiers - always use full S3 key with prefix when S3 is enabled
    // Middleware sets file.filename or file.s3Key to the full S3 key (e.g., "uploads/filename.mp4")
    let videoKey, thumbnailKey;
    
    if (isS3Enabled()) {
      // For S3: Middleware already sets file.filename or file.s3Key with full prefix
      // Priority: s3Key > filename > extract from s3Url and add prefix
      const uploadPrefix = getUploadPrefix();
      
      // Video key
      if (videoFile.s3Key) {
        videoKey = videoFile.s3Key; // Full S3 key with prefix
      } else if (videoFile.filename) {
        // Middleware should have set this to full key, but ensure prefix exists
        videoKey = videoFile.filename.startsWith(uploadPrefix) 
          ? videoFile.filename 
          : uploadPrefix + videoFile.filename;
      } else {
        // Fallback: extract from URL and ensure prefix
        const extracted = videoFile.s3Url ? extractFileName(videoFile.s3Url) : null;
        if (extracted) {
          videoKey = extracted.startsWith(uploadPrefix) ? extracted : uploadPrefix + extracted;
        } else {
          // Last resort: generate filename and add prefix
          const filename = `${Date.now()}-${videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          videoKey = uploadPrefix + filename;
        }
      }
      
      // Thumbnail key
      if (thumbFile) {
        if (thumbFile.s3Key) {
          thumbnailKey = thumbFile.s3Key; // Full S3 key with prefix
        } else if (thumbFile.filename) {
          thumbnailKey = thumbFile.filename.startsWith(uploadPrefix)
            ? thumbFile.filename
            : uploadPrefix + thumbFile.filename;
        } else {
          const extracted = thumbFile.s3Url ? extractFileName(thumbFile.s3Url) : null;
          if (extracted) {
            thumbnailKey = extracted.startsWith(uploadPrefix) ? extracted : uploadPrefix + extracted;
          } else {
            const filename = `${Date.now()}-${thumbFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            thumbnailKey = uploadPrefix + filename;
          }
        }
      } else {
        thumbnailKey = null;
      }
    } else {
      // For local storage: use filename as-is (no prefix needed)
      videoKey = videoFile.filename;
      thumbnailKey = thumbFile?.filename || null;
    }
    
    console.log('🔑 Video S3 Key (stored in DB):', videoKey);
    console.log('🔑 Thumbnail S3 Key (stored in DB):', thumbnailKey);

    const newVideo = new Video({
      title,
      description,
      contentType, // Use contentType from request body
      category: category ? category.split(',') : [], // if array comes as CSV
      customCategory,
      videoUrl: videoKey, // Store S3 key or filename
      // Store ONLY key/filename; frontend will build full URL
      thumbnailUrl: thumbnailKey,
      uploadedBy: req.user.userId // from authenticate middleware (JWT contains userId, not _id)
    });

    console.log('💾 Saving video to database...');
    await newVideo.save();
    console.log('✅ Video saved successfully');
    
    // Ensure thumbnailUrl is included in response
    const videoResponse = {
      ...newVideo.toObject(),
      // Return ONLY filenames/keys; frontend will build full URL
      videoUrl: videoKey,
      thumbnailUrl: thumbnailKey,
      thumbnail: thumbnailKey // Frontend compatibility
    };

    console.log('📹 Video upload response:', {
      id: videoResponse._id,
      title: videoResponse.title,
      videoUrl: videoResponse.videoUrl,
      thumbnailUrl: videoResponse.thumbnailUrl,
      thumbnail: videoResponse.thumbnail,
      hasThumbnail: !!thumbFile,
      thumbnailFilename: thumbFile?.filename
    });

    res.status(201).json({ 
      success: true,
      message: 'Video uploaded successfully', 
      video: videoResponse,
      data: videoResponse,
      duration: videoDuration
    });
  } catch (err) {
    console.error('Upload video error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to upload video', 
      message: err.message,
      details: err.message 
    });
  }
};

const getAllVideos = async (req, res) => {
  try {
    // Exclude deleted videos
    const videos = await Video.find({ isDeleted: { $ne: true } }).populate('uploadedBy', 'name email profilePic');
    
    console.log(`📹 getAllVideos: Found ${videos.length} videos`);
    
    // Return videos with signed URLs if S3 is enabled
    const videosWithFilenames = await Promise.all(videos.map(async (video) => {
      const videoObj = video.toObject();
      
      // Get S3 keys (with prefix if S3 enabled)
      const videoKey = videoObj.videoUrl; // Already has prefix if S3 enabled
      const thumbnailKey = videoObj.thumbnailUrl || null;

      // Generate signed URLs if S3 is enabled
      // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
      let videoSignedUrl = null;
      let videoSignedUrlExpiresAt = null;
      let thumbnailSignedUrl = null;
      let thumbnailSignedUrlExpiresAt = null;

      if (isS3Enabled() && videoKey) {
        try {
          const signedUrlData = await getSignedVideoUrl(videoKey);
          videoSignedUrl = signedUrlData.url; // Extract URL from response object
          videoSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for video ${videoKey}:`, error.message);
        }
      }

      if (isS3Enabled() && thumbnailKey) {
        try {
          const signedUrlData = await getSignedThumbnailUrl(thumbnailKey);
          thumbnailSignedUrl = signedUrlData.url; // Extract URL from response object
          thumbnailSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for thumbnail ${thumbnailKey}:`, error.message);
        }
      }
      
      // Log thumbnail processing for debugging
      if (!videoObj.thumbnailUrl) {
        console.warn('⚠️ Video missing thumbnail in getAllVideos:', {
          id: videoObj._id,
          title: videoObj.title
        });
      }
      
      return {
        ...videoObj,
        // Keys (for reference)
        videoKey: videoKey,
        thumbnailKey: thumbnailKey,
        // Signed URLs (for accessing private S3 objects)
        // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
        videoSignedUrl: videoSignedUrl,
        videoSignedUrlExpiresAt: videoSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
        thumbnailSignedUrl: thumbnailSignedUrl,
        thumbnailSignedUrlExpiresAt: thumbnailSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
        // Main fields - use signed URLs if available, otherwise use keys (for local storage)
        videoUrl: videoSignedUrl || videoKey, // Use signed URL if available, otherwise key
        thumbnailUrl: thumbnailSignedUrl || thumbnailKey, // Use signed URL if available, otherwise key
        thumbnail: thumbnailSignedUrl || thumbnailKey // Use signed URL if available, otherwise key
      };
    }));
    
    console.log(`📹 getAllVideos: Returning ${videosWithFilenames.length} videos with thumbnails`);
    
    res.json(videosWithFilenames);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
};

const getVideoById = async (req, res) => {
  try {
    const video = await Video.findOne({ 
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).populate('uploadedBy', 'name email profilePic');
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    const videoObj = video.toObject();
    
    // Get S3 keys (with prefix if S3 enabled)
    const videoKey = videoObj.videoUrl; // Already has prefix if S3 enabled
    const thumbnailKey = videoObj.thumbnailUrl || null;

    // Generate signed URLs if S3 is enabled
    // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
    let videoSignedUrl = null;
    let videoSignedUrlExpiresAt = null;
    let thumbnailSignedUrl = null;
    let thumbnailSignedUrlExpiresAt = null;

    if (isS3Enabled() && videoKey) {
      try {
        const signedUrlData = await getSignedVideoUrl(videoKey);
        videoSignedUrl = signedUrlData.url; // Extract URL from response object
        videoSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        console.log('✅ Generated signed URL for video in getVideoById:', videoKey.substring(0, 50));
      } catch (error) {
        console.error(`❌ Failed to generate signed URL for video ${videoKey}:`, error.message);
      }
    }

    if (isS3Enabled() && thumbnailKey) {
      try {
        const signedUrlData = await getSignedThumbnailUrl(thumbnailKey);
        thumbnailSignedUrl = signedUrlData.url; // Extract URL from response object
        thumbnailSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        console.log('✅ Generated signed URL for thumbnail in getVideoById:', thumbnailKey.substring(0, 50));
      } catch (error) {
        console.error(`❌ Failed to generate signed URL for thumbnail ${thumbnailKey}:`, error.message);
      }
    }
    
    // Log thumbnail processing for debugging
    if (!videoObj.thumbnailUrl) {
      console.warn('⚠️ Video missing thumbnail in getVideoById:', {
        id: videoObj._id,
        title: videoObj.title
      });
    }
    
    const videoWithFullUrls = {
      ...videoObj,
      // Keys (for reference)
      videoKey: videoKey,
      thumbnailKey: thumbnailKey,
      // Signed URLs (for accessing private S3 objects)
      // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
      videoSignedUrl: videoSignedUrl,
      videoSignedUrlExpiresAt: videoSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
      thumbnailSignedUrl: thumbnailSignedUrl,
      thumbnailSignedUrlExpiresAt: thumbnailSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
      // Main fields - use signed URLs if available, otherwise use keys (for local storage)
      videoUrl: videoSignedUrl || videoKey, // Use signed URL if available, otherwise key
      thumbnailUrl: thumbnailSignedUrl || thumbnailKey, // Use signed URL if available, otherwise key
      thumbnail: thumbnailSignedUrl || thumbnailKey // Use signed URL if available, otherwise key
    };
    
    console.log('📹 Video by ID response:', {
      id: videoObj._id,
      title: videoObj.title,
      videoKey: videoKey,
      hasVideoSignedUrl: !!videoSignedUrl,
      videoUrl: videoWithFullUrls.videoUrl,
      thumbnailKey: thumbnailKey,
      hasThumbnailSignedUrl: !!thumbnailSignedUrl,
      thumbnailUrl: videoWithFullUrls.thumbnailUrl,
      thumbnail: videoWithFullUrls.thumbnail
    });
    
    res.json(videoWithFullUrls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
};

const getMyVideos = async (req, res) => {
  try {
    const userId = req.user.userId; // From JWT token

    // Get query parameters for filtering and pagination
    const contentType = req.query.type; // 'reel' or 'full'
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;

    // Build query
    let query = { uploadedBy: userId };
    if (contentType && ['reel', 'full'].includes(contentType)) {
      query.contentType = contentType;
    }
    // Teachers can see their deleted videos if includeDeleted=true, otherwise exclude them
    const includeDeleted = req.query.includeDeleted === 'true';
    if (!includeDeleted) {
      query.isDeleted = { $ne: true };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalVideos = await Video.countDocuments(query);
    const totalPages = Math.ceil(totalVideos / limit);

    const videos = await Video.find(query)
      .populate('uploadedBy', 'name email profilePic')
      .sort({ createdAt: -1 }) // Latest first
      .skip(skip)
      .limit(limit);

    // Return ONLY filenames; frontend will build full URL
    const videosWithFilenames = videos.map(video => {
      const videoObj = video.toObject();
      const filename = toFilenameOnly(videoObj.videoUrl);

      // Thumbnail filename only
      const thumbnailUrl = toFilenameOnly(videoObj.thumbnailUrl);
      
      // Log thumbnail processing for debugging
      if (!videoObj.thumbnailUrl) {
        console.warn('⚠️ Video missing thumbnail:', {
          id: videoObj._id,
          title: videoObj.title
        });
      } else {
        console.log('📹 Processing video for my videos:', {
          id: videoObj._id,
          title: videoObj.title,
          originalThumbnailUrl: videoObj.thumbnailUrl,
          processedThumbnail: thumbnailUrl,
          hasThumbnail: !!videoObj.thumbnailUrl
        });
      }

      return {
        id: videoObj._id,
        title: videoObj.title,
        description: videoObj.description,
        contentType: videoObj.contentType,
        category: videoObj.category,
        thumbnail: thumbnailUrl,
        thumbnailUrl: thumbnailUrl,
        videoUrl: filename,
        filename: filename,
        creator: {
          id: videoObj.uploadedBy._id,
          name: videoObj.uploadedBy.name,
          email: videoObj.uploadedBy.email,
          profilePic: ensureFullUrl(videoObj.uploadedBy.profilePic)
        },
        stats: {
          likes: videoObj.likes || 0
        },
        createdAt: videoObj.createdAt
      };
    });

    res.json({
      success: true,
      data: {
        videos: videosWithFilenames,
        pagination: {
          currentPage: page,
          limit,
          totalVideos,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        metadata: {
          contentType: contentType || 'all'
        }
      }
    });
  } catch (err) {
    console.error('Get my videos error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch your videos',
      details: err.message
    });
  }
};


const streamVideo = async (req, res) => {
  try {
    const videoId = req.params.id;
    const video = await Video.findById(videoId);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Extract filename from full URL or relative path
    const filename = video.videoUrl.includes('/uploads/') 
      ? video.videoUrl.split('/uploads/')[1] 
      : video.videoUrl.replace('/uploads/', '');
    
    const videoPath = path.join(process.cwd(), 'uploads', filename);
    
    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file not found on server' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Partial content request (for video seeking)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // Full video request
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Accept-Ranges'
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    console.error('Stream video error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to stream video',
      details: err.message 
    });
  }
};

// Stream all videos without requiring ID - perfect for video feed
const streamAllVideos = async (req, res) => {
  try {
    console.log('📱 Stream all videos request received');

    // Get query parameters for filtering
    const contentType = req.query.type; // 'reel' or 'full'
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;

    // Build query - exclude deleted videos for students
    let query = { isDeleted: { $ne: true } };
    if (contentType && ['reel', 'full'].includes(contentType)) {
      query.contentType = contentType;
    }

    console.log('🔍 Query for videos:', JSON.stringify(query, null, 2));
    console.log('📊 Request params:', { contentType, limit, page });

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalVideos = await Video.countDocuments(query);
    const totalPages = Math.ceil(totalVideos / limit);
    
    console.log(`📹 Found ${totalVideos} videos matching query (Page ${page}/${totalPages})`);

    // Get videos from database
    const videos = await Video.find(query)
      .populate('uploadedBy', 'name email profilePic')
      .sort({ createdAt: -1 }) // Latest first
      .skip(skip)
      .limit(limit);

    if (videos.length === 0) {
      return res.json({
        success: true,
        data: {
          videos: [],
          pagination: {
            currentPage: page,
            limit,
            totalVideos: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
          },
          metadata: {
            contentType: contentType || 'all',
            streamType: 'feed_format'
          }
        }
      });
    }

    // Transform videos for streaming format with signed URLs
    const streamableVideos = await Promise.all(videos.map(async (video) => {
      const videoObj = video.toObject();

      // Get S3 keys (with prefix if S3 enabled)
      const videoKey = videoObj.videoUrl; // Already has prefix if S3 enabled
      const thumbnailKey = videoObj.thumbnailUrl || null;

      // Generate signed URLs if S3 is enabled
      // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
      let videoSignedUrl = null;
      let videoSignedUrlExpiresAt = null;
      let thumbnailSignedUrl = null;
      let thumbnailSignedUrlExpiresAt = null;

      if (isS3Enabled() && videoKey) {
        try {
          const signedUrlData = await getSignedVideoUrl(videoKey);
          videoSignedUrl = signedUrlData.url; // Extract URL from response object
          videoSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for video ${videoKey}:`, error.message);
        }
      }

      if (isS3Enabled() && thumbnailKey) {
        try {
          const signedUrlData = await getSignedThumbnailUrl(thumbnailKey);
          thumbnailSignedUrl = signedUrlData.url; // Extract URL from response object
          thumbnailSignedUrlExpiresAt = signedUrlData.expiresAt; // Expiry timestamp for frontend
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for thumbnail ${thumbnailKey}:`, error.message);
        }
      }

      return {
        id: videoObj._id,
        title: videoObj.title,
        description: videoObj.description,
        contentType: videoObj.contentType,
        category: videoObj.category,
        // Keys (for reference)
        videoKey: videoKey,
        thumbnailKey: thumbnailKey,
        // Signed URLs (for accessing private S3 objects)
        // Videos delete hone tak accessible rahengi (7 days expiry, frontend auto-refresh karega)
        videoSignedUrl: videoSignedUrl,
        videoSignedUrlExpiresAt: videoSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
        thumbnailSignedUrl: thumbnailSignedUrl,
        thumbnailSignedUrlExpiresAt: thumbnailSignedUrlExpiresAt, // Frontend ko pata hoga kab refresh karna hai
        // Legacy fields (for backward compatibility)
        thumbnail: thumbnailKey,
        thumbnailUrl: thumbnailKey,
        videoUrl: videoKey,
        filename: videoKey,
        creator: {
          id: videoObj.uploadedBy?._id || null,
          name: videoObj.uploadedBy?.name || 'Unknown',
          email: videoObj.uploadedBy?.email || '',
          profilePic: videoObj.uploadedBy?.profilePic ? ensureFullUrl(videoObj.uploadedBy.profilePic) : null
        },
        stats: {
          likes: videoObj.likes || 0,
          views: videoObj.views || 0,
          shares: videoObj.shares || 0
        },
        likedBy: videoObj.likedBy || [],
        createdAt: videoObj.createdAt
      };
    }));

    console.log(`📱 Streaming ${streamableVideos.length} videos (Page ${page}/${totalPages})`);

    res.json({
      success: true,
      data: {
        videos: streamableVideos,
        pagination: {
          currentPage: page,
          limit,
          totalVideos,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        metadata: {
          contentType: contentType || 'all',
          streamType: 'feed_format'
        }
      }
    });

  } catch (err) {
    console.error('📱 Stream all videos error:', err);
    console.error('📱 Error stack:', err.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to stream videos',
      message: err.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

const deleteVideo = async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.userId; // From JWT token

    // Find the video first
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check if user owns the video
    if (video.uploadedBy.toString() !== userId) {
      return res.status(403).json({ 
        error: 'Unauthorized - You can only delete your own videos' 
      });
    }

    // Delete the video file from filesystem
    const videoFilename = toFilenameOnly(video.videoUrl);
    const videoPath = path.join(process.cwd(), 'uploads', videoFilename);
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    // Delete thumbnail if exists
    if (video.thumbnailUrl) {
      const thumbFilename = toFilenameOnly(video.thumbnailUrl);
      const thumbPath = path.join(process.cwd(), 'uploads', thumbFilename);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }

    // Soft delete: Mark as deleted instead of removing from database
    video.isDeleted = true;
    video.deletedAt = new Date();
    await video.save();
    
    console.log('🗑️ Video soft deleted:', {
      videoId: videoId,
      title: video.title,
      deletedAt: video.deletedAt
    });
    
    res.json({ 
      success: true,
      message: 'Video deleted successfully' 
    });
  } catch (err) {
    console.error('Delete video error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete video',
      details: err.message 
    });
  }
};

// Update Video (Teacher can update their own videos)
const updateVideo = async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.userId; // From JWT token
    const { title, description, category, customCategory, contentType } = req.body;
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    console.log('📝 Update video request:', {
      videoId,
      userId,
      title,
      description,
      contentType,
      hasVideoFile: !!videoFile,
      hasThumbFile: !!thumbFile
    });

    // Find the video first
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ 
        success: false,
        error: 'Video not found' 
      });
    }

    // Check if video is deleted
    if (video.isDeleted) {
      return res.status(404).json({ 
        success: false,
        error: 'Video has been deleted' 
      });
    }

    // Check if user owns the video
    if (video.uploadedBy.toString() !== userId) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized - You can only update your own videos' 
      });
    }

    // Update fields if provided
    if (title) video.title = title;
    if (description) video.description = description;
    if (contentType && ['reel', 'full'].includes(contentType)) {
      video.contentType = contentType;
    }
    if (category !== undefined) {
      video.category = Array.isArray(category) ? category : category.split(',');
    }
    if (customCategory !== undefined) video.customCategory = customCategory;

    // Update video file if provided
    if (videoFile) {
      // Delete old video file if exists
      const oldVideoFilename = toFilenameOnly(video.videoUrl);
      const oldVideoPath = path.join(process.cwd(), 'uploads', oldVideoFilename);
      if (fs.existsSync(oldVideoPath)) {
        fs.unlinkSync(oldVideoPath);
        console.log('🗑️ Deleted old video file:', oldVideoFilename);
      }
      // Store ONLY filename
      video.videoUrl = videoFile.filename;
    }

    // Update thumbnail if provided
    if (thumbFile) {
      // Delete old thumbnail if exists
      if (video.thumbnailUrl) {
        const oldThumbFilename = toFilenameOnly(video.thumbnailUrl);
        const oldThumbPath = path.join(process.cwd(), 'uploads', oldThumbFilename);
        if (fs.existsSync(oldThumbPath)) {
          fs.unlinkSync(oldThumbPath);
          console.log('🗑️ Deleted old thumbnail:', oldThumbFilename);
        }
      }
      // Store ONLY filename
      video.thumbnailUrl = thumbFile.filename;
    }

    await video.save();

    console.log('✅ Video updated successfully:', {
      videoId: video._id,
      title: video.title,
      contentType: video.contentType
    });

    const videoObj = video.toObject();
    res.json({
      success: true,
      message: 'Video updated successfully',
      video: {
        ...videoObj,
        videoUrl: toFilenameOnly(videoObj.videoUrl),
        thumbnailUrl: toFilenameOnly(videoObj.thumbnailUrl),
        thumbnail: toFilenameOnly(videoObj.thumbnailUrl)
      }
    });
  } catch (err) {
    console.error('Update video error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update video',
      details: err.message 
    });
  }
};

//like video
// PUT /api/videos/:id/like
const likeVideo = async (req, res) => {
  try {
    const { id } = req.params;       // Video ID from URL
    const userId = req.user.userId;  // User ID from auth middleware (JWT contains userId)

    const video = await Video.findById(id);
    if (!video) return res.status(404).json({ success: false, message: "Video not found" });

    const alreadyLiked = video.likedBy.includes(userId);

    if (alreadyLiked) {
      // 👎 Unlike
      video.likes -= 1;
      video.likedBy.pull(userId);
      await video.save();
      return res.json({ success: true, message: "Unliked", likes: video.likes });
    } else {
      // 👍 Like
      video.likes += 1;
      video.likedBy.push(userId);
      await video.save();
      return res.json({ success: true, message: "Liked", likes: video.likes });
    }

  } catch (err) {
    console.error('Like video error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};


//get liked videos
// GET /api/videos/:id/likes
const getLikes = async (req, res) => {
  try {
    const { id } = req.params; // Video ID from URL
    const video = await Video.findById(id).select('likes likedBy'); // return likes and likedBy fields

    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    // Check if user is authenticated to determine isLiked
    let isLiked = false;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const token = authHeader.split(' ')[1];
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        if (decoded && decoded.userId) {
          isLiked = video.likedBy.includes(decoded.userId);
        }
      } catch (tokenError) {
        // Token invalid or expired, isLiked stays false
        console.log('Token verification failed in getLikes:', tokenError.message);
      }
    }

    res.json({
      success: true,
      videoId: id,
      likes: video.likes,
      isLiked: isLiked
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get videos by content type (reel or full)
const getVideosByType = async (req, res) => {
  try {
    const { type } = req.params; // 'reel' or 'full'

    if (!['reel', 'full'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid content type. Must be 'reel' or 'full'"
      });
    }

    const videos = await Video.find({ contentType: type })
      .populate('uploadedBy', 'name email profilePic')
      .sort({ createdAt: -1 }); // Latest first

    console.log(`📹 getVideosByType (${type}): Found ${videos.length} videos`);

    // Return filenames only (frontend builds base URL)
    const videosWithFilenames = videos.map(video => {
      const videoObj = video.toObject();
      const thumbnailUrl = toFilenameOnly(videoObj.thumbnailUrl);
      
      // Log thumbnail processing for debugging
      if (!videoObj.thumbnailUrl) {
        console.warn('⚠️ Video missing thumbnail in getVideosByType:', {
          id: videoObj._id,
          title: videoObj.title,
          type: type
        });
      }
      
      return {
        ...videoObj,
        videoUrl: toFilenameOnly(videoObj.videoUrl),
        thumbnailUrl: thumbnailUrl,
        thumbnail: thumbnailUrl // Also provide as 'thumbnail' for frontend compatibility
      };
    });
    
    console.log(`📹 getVideosByType (${type}): Returning ${videosWithFilenames.length} videos with thumbnails`);

    res.json({
      success: true,
      contentType: type,
      count: videosWithFilenames.length,
      videos: videosWithFilenames
    });
  } catch (err) {
    console.error('Get videos by type error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch videos',
      details: err.message
    });
  }
};

// Increment video view count
// PUT /api/videos/:id/view
const incrementView = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId; // Optional - can be undefined for non-logged users

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    // If user is logged in, check if already viewed
    if (userId) {
      const alreadyViewed = video.viewedBy.includes(userId);
      if (!alreadyViewed) {
        video.views += 1;
        video.viewedBy.push(userId);
        await video.save();
      }
    } else {
      // For non-logged users, just increment
      video.views += 1;
      await video.save();
    }

    res.json({
      success: true,
      message: "View recorded",
      views: video.views
    });
  } catch (err) {
    console.error('Increment view error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};

// Track video share
// PUT /api/videos/:id/share
const trackShare = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    // Increment share count
    video.shares += 1;
    if (userId && !video.sharedBy.includes(userId)) {
      video.sharedBy.push(userId);
    }
    await video.save();

    res.json({
      success: true,
      message: "Share recorded",
      shares: video.shares
    });
  } catch (err) {
    console.error('Track share error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};

// Get video stats (likes, views, shares)
// GET /api/videos/:id/stats
const getVideoStats = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const video = await Video.findById(id).select('likes views shares likedBy savedBy');
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    res.json({
      success: true,
      videoId: id,
      stats: {
        likes: video.likes,
        views: video.views,
        shares: video.shares,
        isLiked: userId ? video.likedBy.includes(userId) : false,
        isSaved: userId ? video.savedBy.includes(userId) : false
      }
    });
  } catch (err) {
    console.error('Get video stats error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};

// Save/Bookmark video
// PUT /api/videos/:id/save
const saveVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }

    // Convert userId to string for comparison (ObjectIds need to be compared as strings)
    const userIdStr = userId.toString();
    const isSaved = video.savedBy.some(savedUserId => savedUserId.toString() === userIdStr);
    
    if (isSaved) {
      // Already saved, unsave it
      video.savedBy = video.savedBy.filter(savedUserId => savedUserId.toString() !== userIdStr);
      await video.save();
      
      res.json({
        success: true,
        message: "Video unsaved",
        isSaved: false
      });
    } else {
      // Not saved, save it
      video.savedBy.push(userId);
      await video.save();
      
      res.json({
        success: true,
        message: "Video saved",
        isSaved: true
      });
    }
  } catch (err) {
    console.error('Save video error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};

// Get saved videos for current user
// GET /api/videos/saved
const getSavedVideos = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    console.log('📚 Getting saved videos for user:', userId);

    // Find all videos saved by this user
    // MongoDB automatically handles ObjectId matching in arrays
    const videos = await Video.find({ 
      savedBy: { $in: [userId] },
      isDeleted: { $ne: true }
    })
      .populate("uploadedBy", "name email role profilePic")
      .sort({ createdAt: -1 });

    console.log(`📚 Found ${videos.length} saved videos for user ${userId}`);

    // Return only filenames for thumbnails (frontend will build full URL)
    const videosWithFilenames = videos.map(video => {
      const videoObj = video.toObject();
      const thumbnailUrl = toFilenameOnly(videoObj.thumbnailUrl);
      
      return {
        ...videoObj,
        videoUrl: toFilenameOnly(videoObj.videoUrl),
        thumbnailUrl: thumbnailUrl,
        thumbnail: thumbnailUrl
      };
    });

    res.json({
      success: true,
      count: videosWithFilenames.length,
      videos: videosWithFilenames
    });
  } catch (err) {
    console.error('Get saved videos error:', err);
    res.status(500).json({ success: false, message: "Server error", details: err.message });
  }
};

export default {
  uploadVideo,
  getAllVideos,
  getVideoById,
  getMyVideos,
  streamVideo,
  streamAllVideos,
  updateVideo,
  deleteVideo,
  likeVideo,
  getLikes,
  getVideosByType,
  incrementView,
  trackShare,
  getVideoStats,
  saveVideo,
  getSavedVideos
};
