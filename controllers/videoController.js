import Video from '../Models/videoModel.js';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffprobe from 'ffprobe-static';

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
  // Default to production server URL
  const defaultUrl = 'http://192.168.31.186:3002';
  let baseUrl = process.env.BASE_URL || defaultUrl;
  
  // Ensure BASE_URL has proper protocol
  if (baseUrl && !baseUrl.startsWith('http')) {
    console.warn('⚠️ Invalid BASE_URL in .env:', baseUrl, '- using default');
    baseUrl = defaultUrl;
  }
  
  return `${baseUrl}/uploads/${filename}`;
};

// Helper function to ensure URL is full (for backward compatibility)
const ensureFullUrl = (url) => {
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
};

const uploadVideo = async (req, res) => {
  try {
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

    // Get video duration and use contentType from request body
    const videoPath = path.join(process.cwd(), 'uploads', videoFile.filename);
    let videoDuration = null;
    
    try {
      videoDuration = await getVideoDuration(videoPath);
      console.log(`📏 Video duration: ${videoDuration}s`);
    } catch (durationError) {
      console.warn('⚠️ Could not determine video duration:', durationError.message);
    }

    // Use contentType from request body, default to 'full' if not provided
    const requestContentType = req.body.contentType;
    const contentType = requestContentType && ['full', 'reel'].includes(requestContentType) ? requestContentType : 'full';
    console.log(`📹 Content type from request: ${requestContentType}, Using: ${contentType}`);

    const newVideo = new Video({
      title,
      description,
      contentType, // Use contentType from request body
      category: category ? category.split(',') : [], // if array comes as CSV
      customCategory,
      videoUrl: generateFileUrl(videoFile.filename),
      thumbnailUrl: thumbFile ? generateFileUrl(thumbFile.filename) : null,
      uploadedBy: req.user.userId // from authenticate middleware (JWT contains userId, not _id)
    });

    console.log('💾 Saving video to database...');
    await newVideo.save();
    console.log('✅ Video saved successfully');
    
    // Ensure thumbnailUrl is included in response
    const videoResponse = {
      ...newVideo.toObject(),
      videoUrl: generateFileUrl(videoFile.filename),
      thumbnailUrl: thumbFile ? generateFileUrl(thumbFile.filename) : null,
      thumbnail: thumbFile ? generateFileUrl(thumbFile.filename) : null // Also provide as 'thumbnail' for frontend compatibility
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
    
    // Ensure all URLs are full URLs and provide both thumbnailUrl and thumbnail for compatibility
    const videosWithFullUrls = videos.map(video => {
      const videoObj = video.toObject();
      const thumbnailUrl = ensureFullUrl(videoObj.thumbnailUrl);
      
      // Log thumbnail processing for debugging
      if (!videoObj.thumbnailUrl) {
        console.warn('⚠️ Video missing thumbnail in getAllVideos:', {
          id: videoObj._id,
          title: videoObj.title
        });
      }
      
      return {
        ...videoObj,
        videoUrl: ensureFullUrl(videoObj.videoUrl),
        thumbnailUrl: thumbnailUrl,
        thumbnail: thumbnailUrl // Also provide as 'thumbnail' for frontend compatibility
      };
    });
    
    console.log(`📹 getAllVideos: Returning ${videosWithFullUrls.length} videos with thumbnails`);
    
    res.json(videosWithFullUrls);
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
    
    // Ensure URLs are full URLs and provide both thumbnailUrl and thumbnail for compatibility
    const thumbnailUrl = ensureFullUrl(videoObj.thumbnailUrl);
    
    // Log thumbnail processing for debugging
    if (!videoObj.thumbnailUrl) {
      console.warn('⚠️ Video missing thumbnail in getVideoById:', {
        id: videoObj._id,
        title: videoObj.title
      });
    }
    
    const videoWithFullUrls = {
      ...videoObj,
      videoUrl: ensureFullUrl(videoObj.videoUrl),
      thumbnailUrl: thumbnailUrl,
      thumbnail: thumbnailUrl // Also provide as 'thumbnail' for frontend compatibility
    };
    
    console.log('📹 Video by ID response:', {
      id: videoObj._id,
      title: videoObj.title,
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

    // Ensure all URLs are full URLs and transform for streaming format
    const videosWithFullUrls = videos.map(video => {
      const videoObj = video.toObject();
      const filename = videoObj.videoUrl.includes('/uploads/')
        ? videoObj.videoUrl.split('/uploads/')[1]
        : videoObj.videoUrl.replace('/uploads/', '');

      // Ensure thumbnail URL is properly generated
      const thumbnailUrl = ensureFullUrl(videoObj.thumbnailUrl);
      
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
        thumbnail: thumbnailUrl, // Frontend expects 'thumbnail'
        thumbnailUrl: thumbnailUrl, // Also provide 'thumbnailUrl' for compatibility
        videoUrl: ensureFullUrl(videoObj.videoUrl),
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
        videos: videosWithFullUrls,
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

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalVideos = await Video.countDocuments(query);
    const totalPages = Math.ceil(totalVideos / limit);

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

    // Transform videos for streaming format
    const streamableVideos = videos.map(video => {
      const videoObj = video.toObject();

      // Extract filename from videoUrl
      const filename = videoObj.videoUrl.includes('/uploads/')
        ? videoObj.videoUrl.split('/uploads/')[1]
        : videoObj.videoUrl.replace('/uploads/', '');

      // Ensure thumbnail URL is properly generated
      const thumbnailUrl = ensureFullUrl(videoObj.thumbnailUrl);
      
      // Log thumbnail processing for debugging
      if (!videoObj.thumbnailUrl) {
        console.warn('⚠️ Video missing thumbnail:', {
          id: videoObj._id,
          title: videoObj.title
        });
      } else {
        console.log('📹 Processing video for stream:', {
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
        thumbnail: thumbnailUrl, // Frontend expects 'thumbnail'
        thumbnailUrl: thumbnailUrl, // Also provide 'thumbnailUrl' for compatibility
        videoUrl: ensureFullUrl(videoObj.videoUrl),
        filename: filename, // For direct streaming
        creator: {
          id: videoObj.uploadedBy._id,
          name: videoObj.uploadedBy.name,
          email: videoObj.uploadedBy.email,
          profilePic: ensureFullUrl(videoObj.uploadedBy.profilePic)
        },
        stats: {
          likes: videoObj.likes || 0,
          views: videoObj.views || 0,
          shares: videoObj.shares || 0
        },
        likedBy: videoObj.likedBy || [],
        createdAt: videoObj.createdAt
      };
    });

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
    res.status(500).json({
      success: false,
      error: 'Failed to stream videos',
      details: err.message
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
    const videoFilename = video.videoUrl.includes('/uploads/') 
      ? video.videoUrl.split('/uploads/')[1] 
      : video.videoUrl.replace('/uploads/', '');
    const videoPath = path.join(process.cwd(), 'uploads', videoFilename);
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    // Delete thumbnail if exists
    if (video.thumbnailUrl) {
      const thumbFilename = video.thumbnailUrl.includes('/uploads/') 
        ? video.thumbnailUrl.split('/uploads/')[1] 
        : video.thumbnailUrl.replace('/uploads/', '');
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
      const oldVideoFilename = video.videoUrl.includes('/uploads/') 
        ? video.videoUrl.split('/uploads/')[1] 
        : video.videoUrl.replace('/uploads/', '');
      const oldVideoPath = path.join(process.cwd(), 'uploads', oldVideoFilename);
      if (fs.existsSync(oldVideoPath)) {
        fs.unlinkSync(oldVideoPath);
        console.log('🗑️ Deleted old video file:', oldVideoFilename);
      }
      video.videoUrl = generateFileUrl(videoFile.filename);
    }

    // Update thumbnail if provided
    if (thumbFile) {
      // Delete old thumbnail if exists
      if (video.thumbnailUrl) {
        const oldThumbFilename = video.thumbnailUrl.includes('/uploads/') 
          ? video.thumbnailUrl.split('/uploads/')[1] 
          : video.thumbnailUrl.replace('/uploads/', '');
        const oldThumbPath = path.join(process.cwd(), 'uploads', oldThumbFilename);
        if (fs.existsSync(oldThumbPath)) {
          fs.unlinkSync(oldThumbPath);
          console.log('🗑️ Deleted old thumbnail:', oldThumbFilename);
        }
      }
      video.thumbnailUrl = generateFileUrl(thumbFile.filename);
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
        videoUrl: ensureFullUrl(videoObj.videoUrl),
        thumbnailUrl: ensureFullUrl(videoObj.thumbnailUrl),
        thumbnail: ensureFullUrl(videoObj.thumbnailUrl)
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

    // Ensure all URLs are full URLs and provide both thumbnailUrl and thumbnail for compatibility
    const videosWithFullUrls = videos.map(video => {
      const videoObj = video.toObject();
      const thumbnailUrl = ensureFullUrl(videoObj.thumbnailUrl);
      
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
        videoUrl: ensureFullUrl(videoObj.videoUrl),
        thumbnailUrl: thumbnailUrl,
        thumbnail: thumbnailUrl // Also provide as 'thumbnail' for frontend compatibility
      };
    });
    
    console.log(`📹 getVideosByType (${type}): Returning ${videosWithFullUrls.length} videos with thumbnails`);

    res.json({
      success: true,
      contentType: type,
      count: videosWithFullUrls.length,
      videos: videosWithFullUrls
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

    const video = await Video.findById(id).select('likes views shares likedBy');
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
        isLiked: userId ? video.likedBy.includes(userId) : false
      }
    });
  } catch (err) {
    console.error('Get video stats error:', err);
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
  getVideoStats
};
