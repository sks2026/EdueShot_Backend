import { CoursePlaylist } from "../Models/courseplaylistModel.js";
import { Course } from "../Models/courseModel.js";
import ffmpeg from 'fluent-ffmpeg';
import ffprobe from 'ffprobe-static';
import path from 'path';
import fs from 'fs';
import { isS3Enabled, getSignedVideoUrl, getSignedThumbnailUrl, getUploadPrefix } from '../services/s3Service.js';

// Set ffprobe path
ffmpeg.setFfprobePath(ffprobe.path);

// Maximum video duration in seconds (5 minutes)
const MAX_VIDEO_DURATION_SECONDS = 300;

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

// Get base URL configuration
const getBaseUrl = () => {
  // Use production IP for external access
  const defaultUrl = 'http://192.168.31.186:3002';
  const baseUrl = process.env.BASE_URL || defaultUrl;

  // Ensure BASE_URL has proper protocol
  if (baseUrl && !baseUrl.startsWith('http')) {
    return defaultUrl;
  }

  console.log('🌐 Base URL configured:', baseUrl);
  return baseUrl;
};

// Helper function to generate full URL for uploaded files
const generateFileUrl = (filename) => {
  if (!filename) return null;
  
  const baseUrl = getBaseUrl();
  const fullUrl = `${baseUrl}/uploads/${filename}`;
  
  console.log('🔗 Generated file URL:', fullUrl);
  return fullUrl;
};

// Helper function to extract filename from URL (returns only filename)
const toFilenameOnly = (url) => {
  if (!url) return null;
  
  // If already just a filename (no http, no /uploads/), return as-is
  if (!url.startsWith('http') && !url.startsWith('/')) {
    return url;
  }
  
  // Extract filename from full URL or /uploads/ path
  const parts = url.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};

// Helper function to process playlist item and return only filenames
const processPlaylistItem = (item) => {
  if (!item) return null;
  
  const processedItem = {
    ...item.toObject ? item.toObject() : item,
    thumbnail: toFilenameOnly(item.thumbnail), // Return only filename
    videoFile: item.videoFile ? toFilenameOnly(item.videoFile) : null, // Return only filename
    isFree: item.isFree || false,
  };
  
  console.log('📝 Processed playlist item (filenames only):', {
    thumbnail: processedItem.thumbnail,
    videoFile: processedItem.videoFile,
    isFree: processedItem.isFree
  });
  
  return processedItem;
};

// ✅ Get Base URL Configuration (for frontend)
export const getBaseUrlConfig = async (req, res) => {
  try {
    const baseUrl = getBaseUrl();
    
    res.status(200).json({
      success: true,
      baseUrl: baseUrl,
      uploadsUrl: `${baseUrl}/uploads/`,
      message: "Base URL configuration retrieved successfully"
    });
  } catch (error) {
    console.error('Get base URL config error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Create Playlist Item (only Teacher who owns the course)
export const createPlaylistItem = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId } = req.params;
    let { title, description, contentType, category, duration, isFree } = req.body;

    // Clean up values (remove quotes if present)
    title = title?.replace(/^"|"$/g, '').trim();
    description = description?.replace(/^"|"$/g, '').trim();
    category = category?.replace(/^"|"$/g, '').trim();
    contentType = contentType?.replace(/^"|"$/g, '').trim();

    // Parse isFree to boolean
    const isVideoFree = isFree === 'true' || isFree === true;

    console.log('📦 Received playlist item data:', { title, description, contentType, category, courseId, isFree: isVideoFree });

    // Get uploaded files from multer
    const videoFile = req.files?.video?.[0]?.filename;
    const thumbnail = req.files?.thumbnail?.[0]?.filename;

    console.log('📁 Uploaded files:', { videoFile, thumbnail });

    // Check if user is teacher or admin
    if (userRole !== "teacher" && userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only teachers and admins can create playlist items",
      });
    }

    // Validate required fields
    if (!title || !description || !contentType) {
      return res.status(400).json({
        success: false,
        message: "Title, description, and contentType are required",
      });
    }

    // Set default category if not provided
    if (!category) {
      category = 'general';
    }

    // Validate thumbnail is uploaded
    if (!thumbnail) {
      return res.status(400).json({
        success: false,
        message: "Thumbnail file is required",
      });
    }

    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // Check ownership: Admin can add to any course, teacher can only add to their own courses
    if (userRole !== "admin" && course.teacher && course.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only add playlist items to your own courses",
      });
    }

    // Validate videoFile for video/audio content (contentType can be "video", "audio", "full", or "reel")
    const isVideoContent = ["video", "audio", "full", "reel"].includes(contentType);
    if (isVideoContent && !videoFile) {
      return res.status(400).json({
        success: false,
        message: "Video file is required for video/audio content type",
      });
    }

    console.log('📹 ContentType received:', contentType, 'isVideoContent:', isVideoContent);

    // Check video duration (max 5 minutes = 300 seconds)
    let videoDuration = null;
    if (videoFile && isVideoContent) {
      try {
        const videoPath = path.join(process.cwd(), 'uploads', videoFile);
        videoDuration = await getVideoDuration(videoPath);

        if (videoDuration > MAX_VIDEO_DURATION_SECONDS) {
          // Delete the uploaded file since it's too long
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
          }
          // Also delete the thumbnail if uploaded
          if (thumbnail) {
            const thumbPath = path.join(process.cwd(), 'uploads', thumbnail);
            if (fs.existsSync(thumbPath)) {
              fs.unlinkSync(thumbPath);
            }
          }

          const durationMinutes = Math.floor(videoDuration / 60);
          const durationSeconds = Math.floor(videoDuration % 60);

          return res.status(400).json({
            success: false,
            message: `Video duration (${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}) exceeds maximum allowed duration of 5 minutes. Please upload a shorter video.`,
          });
        }

        console.log(`✅ Video duration validated: ${videoDuration} seconds`);
      } catch (durationError) {
        console.warn('⚠️ Could not determine video duration:', durationError.message);
        // Continue without duration validation if ffprobe fails
      }
    }

    // Get the next order number for this course
    const lastItem = await CoursePlaylist.findOne({ course: courseId })
      .sort({ order: -1 });
    const nextOrder = lastItem ? lastItem.order + 1 : 1;

    const playlistItem = new CoursePlaylist({
      title,
      description,
      contentType,
      category,
      videoFile: videoFile || null,
      thumbnail,
      course: courseId,
      teacher: userId,
      order: nextOrder,
      duration: videoDuration || duration || null,
      isFree: isVideoFree,
    });

    await playlistItem.save();

    // Verify files exist after save
    if (videoFile) {
      const videoPath = path.join(process.cwd(), 'uploads', videoFile);
      const videoExists = fs.existsSync(videoPath);
      console.log(`✅ Video file verification: ${videoFile} exists: ${videoExists}`);
      console.log(`📁 Full video path: ${videoPath}`);

      if (!videoExists) {
        console.error('❌ WARNING: Video file was not found after upload!');
        // List files in uploads directory
        const uploadsDir = path.join(process.cwd(), 'uploads');
        const files = fs.readdirSync(uploadsDir);
        console.log('📂 Files in uploads directory:', files.slice(-10)); // Last 10 files
      }
    }

    if (thumbnail) {
      const thumbPath = path.join(process.cwd(), 'uploads', thumbnail);
      const thumbExists = fs.existsSync(thumbPath);
      console.log(`✅ Thumbnail file verification: ${thumbnail} exists: ${thumbExists}`);
    }

    // Process the playlist item to ensure all URLs are full
    const processedPlaylistItem = processPlaylistItem(playlistItem);

    res.status(201).json({
      success: true,
      message: "Playlist item created successfully",
      playlistItem: processedPlaylistItem,
      debug: {
        videoFileExists: videoFile ? fs.existsSync(path.join(process.cwd(), 'uploads', videoFile)) : null,
        thumbnailExists: thumbnail ? fs.existsSync(path.join(process.cwd(), 'uploads', thumbnail)) : null,
        uploadsDir: path.join(process.cwd(), 'uploads')
      }
    });
  } catch (error) {
    console.error('Create playlist item error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Get All Playlist Items for a Course
export const getCoursePlaylist = async (req, res) => {
  try {
    const { courseId } = req.params;
    
    console.log('🔍 Debug: Looking for course with ID:', courseId);
    console.log('🔍 Debug: Course ID type:', typeof courseId);
    console.log('🔍 Debug: Course ID length:', courseId.length);

    // Check if course exists
    const course = await Course.findById(courseId);
    console.log('🔍 Debug: Course found:', course ? 'YES' : 'NO');
    
    if (!course) {
      // Let's also check if there are any courses in the database
      const allCourses = await Course.find({}).select('_id title');
      console.log('🔍 Debug: All courses in database:', allCourses);
      
      return res.status(404).json({
        success: false,
        message: "Course not found",
        debug: {
          requestedCourseId: courseId,
          totalCoursesInDB: allCourses.length,
          availableCourseIds: allCourses.map(c => c._id.toString())
        }
      });
    }

    // Check user role - students should not see deleted items
    const userRole = req.user?.role;
    const userId = req.user?.userId;
    const isStudent = userRole === 'student';
    
    // Build query - exclude deleted items for students
    let query = { course: courseId };
    if (isStudent) {
      query.isDeleted = { $ne: true };
    } else if (userRole === 'teacher') {
      // Teachers can see their own deleted items if they own the course
      // Otherwise, exclude deleted items
      if (course && course.teacher.toString() !== userId) {
        query.isDeleted = { $ne: true };
      }
      // If teacher owns the course, they can see all items (including deleted)
    } else {
      // Admin or other roles - exclude deleted by default
      query.isDeleted = { $ne: true };
    }
    
    const playlistItems = await CoursePlaylist.find(query)
      .populate("teacher", "name email")
      .sort({ order: 1 });

    console.log('📹 Found playlist items:', playlistItems.length);

    // Process all playlist items with signed URLs if S3 is enabled
    const processedPlaylistItems = await Promise.all(playlistItems.map(async (item) => {
      const processed = processPlaylistItem(item);
      
      // Get video and thumbnail keys (with prefix if S3 enabled)
      let videoKey = processed.videoFile; // Might have prefix if S3 enabled
      let thumbnailKey = processed.thumbnail; // Might have prefix if S3 enabled
      
      // Ensure keys have the upload prefix if S3 is enabled
      if (isS3Enabled()) {
        const uploadPrefix = getUploadPrefix();
        if (videoKey && !videoKey.startsWith(uploadPrefix)) {
          videoKey = uploadPrefix + videoKey;
        }
        if (thumbnailKey && !thumbnailKey.startsWith(uploadPrefix)) {
          thumbnailKey = uploadPrefix + thumbnailKey;
        }
      }
      
      // Generate signed URLs if S3 is enabled
      let videoSignedUrl = null;
      let videoSignedUrlExpiresAt = null;
      let thumbnailSignedUrl = null;
      let thumbnailSignedUrlExpiresAt = null;

      if (isS3Enabled() && videoKey) {
        try {
          const signedUrlData = await getSignedVideoUrl(videoKey);
          videoSignedUrl = signedUrlData.url;
          videoSignedUrlExpiresAt = signedUrlData.expiresAt;
          console.log('✅ Generated signed URL for playlist video:', videoKey.substring(0, 50));
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for playlist video ${videoKey}:`, error.message);
        }
      }

      if (isS3Enabled() && thumbnailKey) {
        try {
          const signedUrlData = await getSignedThumbnailUrl(thumbnailKey);
          thumbnailSignedUrl = signedUrlData.url;
          thumbnailSignedUrlExpiresAt = signedUrlData.expiresAt;
          console.log('✅ Generated signed URL for playlist thumbnail:', thumbnailKey.substring(0, 50));
        } catch (error) {
          console.error(`❌ Failed to generate signed URL for playlist thumbnail ${thumbnailKey}:`, error.message);
        }
      }

      // Check if video file actually exists on disk (for local storage)
      let fileExists = false;
      if (item.videoFile && !isS3Enabled()) {
        const videoPath = path.join(process.cwd(), 'uploads', item.videoFile);
        fileExists = fs.existsSync(videoPath);
        console.log(`📹 Video file check: ${item.videoFile}`);
        console.log(`   Database value: ${item.videoFile}`);
        console.log(`   Full path: ${videoPath}`);
        console.log(`   File exists: ${fileExists}`);
      } else if (isS3Enabled() && videoKey) {
        // For S3, assume file exists if we have a key
        fileExists = true;
      }

      return {
        ...processed,
        // Keys (for reference)
        videoKey: videoKey,
        thumbnailKey: thumbnailKey,
        // Signed URLs (for accessing private S3 objects)
        videoSignedUrl: videoSignedUrl,
        videoSignedUrlExpiresAt: videoSignedUrlExpiresAt,
        thumbnailSignedUrl: thumbnailSignedUrl,
        thumbnailSignedUrlExpiresAt: thumbnailSignedUrlExpiresAt,
        // Main fields - use signed URLs if available, otherwise keys/filenames
        videoFile: videoSignedUrl || videoKey || processed.videoFile, // Use signed URL if available
        thumbnail: thumbnailSignedUrl || thumbnailKey || processed.thumbnail, // Use signed URL if available
        fileExists: fileExists
      };
    }));

    res.status(200).json({
      success: true,
      course: {
        _id: course._id,
        title: course.title,
        description: course.description,
      },
      playlistItems: processedPlaylistItems,
      debug: {
        uploadsDir: path.join(process.cwd(), 'uploads'),
        cwd: process.cwd()
      }
    });
  } catch (error) {
    console.error('Get course playlist error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Get Single Playlist Item
export const getPlaylistItemById = async (req, res) => {
  try {
    const { courseId, itemId } = req.params;

    // Check user role - students should not see deleted items
    const userRole = req.user?.role;
    const isStudent = userRole === 'student';
    
    let query = { 
      _id: itemId, 
      course: courseId 
    };
    if (isStudent) {
      query.isDeleted = { $ne: true };
    }
    
    const playlistItem = await CoursePlaylist.findOne(query).populate("teacher", "name email");

    if (!playlistItem) {
      return res.status(404).json({ 
        success: false, 
        message: "Playlist item not found" 
      });
    }

    // Process the playlist item to ensure all URLs are full
    const processedPlaylistItem = processPlaylistItem(playlistItem);

    res.status(200).json({ 
      success: true, 
      playlistItem: processedPlaylistItem 
    });
  } catch (error) {
    console.error('Get playlist item error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Update Playlist Item (only Teacher who owns the course)
export const updatePlaylistItem = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId, itemId } = req.params;
    
    // Get uploaded files from multer (if any)
    const videoFile = req.files?.video?.[0]?.filename;
    const thumbnail = req.files?.thumbnail?.[0]?.filename;

    // Check if user is teacher
    if (userRole !== "teacher") {
      return res.status(403).json({
        success: false,
        message: "Only teachers can update playlist items",
      });
    }

    const playlistItem = await CoursePlaylist.findOne({ 
      _id: itemId, 
      course: courseId 
    });

    if (!playlistItem) {
      return res.status(404).json({
        success: false,
        message: "Playlist item not found",
      });
    }

    if (playlistItem.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own playlist items",
      });
    }

    // Parse request body
    let { title, description, category, contentType, isFree } = req.body;
    
    // Clean up values (remove quotes if present)
    title = title?.replace(/^"|"$/g, '').trim();
    description = description?.replace(/^"|"$/g, '').trim();
    category = category?.replace(/^"|"$/g, '').trim();
    contentType = contentType?.replace(/^"|"$/g, '').trim();
    
    // Update fields if provided
    if (title) playlistItem.title = title;
    if (description) playlistItem.description = description;
    if (category) playlistItem.category = category;
    if (contentType) playlistItem.contentType = contentType;
    
    // Handle isFree field
    if (isFree !== undefined) {
      playlistItem.isFree = isFree === 'true' || isFree === true;
    }
    
    // Delete old files and update with new ones if uploaded
    if (videoFile) {
      // Delete old video file if exists
      if (playlistItem.videoFile) {
        const oldVideoPath = path.join(process.cwd(), 'uploads', playlistItem.videoFile);
        if (fs.existsSync(oldVideoPath)) {
          fs.unlinkSync(oldVideoPath);
          console.log('🗑️ Deleted old video file:', playlistItem.videoFile);
        }
      }
      playlistItem.videoFile = videoFile;
    }
    
    if (thumbnail) {
      // Delete old thumbnail if exists
      if (playlistItem.thumbnail) {
        const oldThumbPath = path.join(process.cwd(), 'uploads', playlistItem.thumbnail);
        if (fs.existsSync(oldThumbPath)) {
          fs.unlinkSync(oldThumbPath);
          console.log('🗑️ Deleted old thumbnail:', playlistItem.thumbnail);
        }
      }
      playlistItem.thumbnail = thumbnail;
    }

    await playlistItem.save();

    // Process the playlist item to ensure all URLs are full
    const processedPlaylistItem = processPlaylistItem(playlistItem);

    res.status(200).json({ 
      success: true, 
      message: "Playlist item updated successfully",
      playlistItem: processedPlaylistItem 
    });
  } catch (error) {
    console.error('Update playlist item error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Delete Playlist Item (only Teacher who owns the course)
export const deletePlaylistItem = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId, itemId } = req.params;

    // Check if user is teacher
    if (userRole !== "teacher") {
      return res.status(403).json({
        success: false,
        message: "Only teachers can delete playlist items",
      });
    }

    const playlistItem = await CoursePlaylist.findOne({ 
      _id: itemId, 
      course: courseId 
    });

    if (!playlistItem) {
      return res.status(404).json({
        success: false,
        message: "Playlist item not found",
      });
    }

    if (playlistItem.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own playlist items",
      });
    }

    // Delete associated files
    if (playlistItem.videoFile) {
      const videoPath = path.join(process.cwd(), 'uploads', playlistItem.videoFile);
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
        console.log('🗑️ Deleted video file:', playlistItem.videoFile);
      }
    }
    
    // Soft delete: Mark as deleted instead of removing from database
    // Note: We keep the files for now in case teacher wants to restore
    playlistItem.isDeleted = true;
    playlistItem.deletedAt = new Date();
    await playlistItem.save();

    console.log('🗑️ Playlist item soft deleted:', {
      itemId: itemId,
      courseId: courseId,
      title: playlistItem.title,
      deletedAt: playlistItem.deletedAt
    });

    res.status(200).json({ 
      success: true, 
      message: "Playlist item deleted successfully" 
    });
  } catch (error) {
    console.error('Delete playlist item error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Reorder Playlist Items
export const reorderPlaylistItems = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { courseId } = req.params;
    const { items } = req.body; // Array of { itemId, order }

    // Check if user is teacher
    if (userRole !== "teacher") {
      return res.status(403).json({
        success: false,
        message: "Only teachers can reorder playlist items",
      });
    }

    // Check if course exists and user owns it
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    if (course.teacher.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only reorder playlist items in your own courses",
      });
    }

    // Update order for each item
    const updatePromises = items.map(({ itemId, order }) => 
      CoursePlaylist.updateOne(
        { _id: itemId, course: courseId, teacher: userId },
        { order }
      )
    );

    await Promise.all(updatePromises);

    res.status(200).json({ 
      success: true, 
      message: "Playlist items reordered successfully" 
    });
  } catch (error) {
    console.error('Reorder playlist items error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// ✅ Like/Unlike Playlist Item
export const likePlaylistItem = async (req, res) => {
  try {
    const { courseId, itemId } = req.params;
    const userId = req.user.userId;

    const playlistItem = await CoursePlaylist.findOne({ 
      _id: itemId, 
      course: courseId 
    });

    if (!playlistItem) {
      return res.status(404).json({ 
        success: false, 
        message: "Playlist item not found" 
      });
    }

    const alreadyLiked = playlistItem.likedBy.includes(userId);

    if (alreadyLiked) {
      // Unlike
      playlistItem.likes -= 1;
      playlistItem.likedBy.pull(userId);
      await playlistItem.save();
      return res.json({ 
        success: true, 
        message: "Playlist item unliked", 
        likes: playlistItem.likes,
        isLiked: false
      });
    } else {
      // Like
      playlistItem.likes += 1;
      playlistItem.likedBy.push(userId);
      await playlistItem.save();
      return res.json({ 
        success: true, 
        message: "Playlist item liked", 
        likes: playlistItem.likes,
        isLiked: true
      });
    }
  } catch (error) {
    console.error('Like playlist item error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      details: error.message 
    });
  }
};

// ✅ Increment View Count
export const incrementViewCount = async (req, res) => {
  try {
    const { courseId, itemId } = req.params;

    const playlistItem = await CoursePlaylist.findOne({ 
      _id: itemId, 
      course: courseId 
    });

    if (!playlistItem) {
      return res.status(404).json({ 
        success: false, 
        message: "Playlist item not found" 
      });
    }

    playlistItem.views += 1;
    await playlistItem.save();

    res.json({ 
      success: true, 
      message: "View count incremented",
      views: playlistItem.views
    });
  } catch (error) {
    console.error('Increment view count error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Server error" 
    });
  }
};
