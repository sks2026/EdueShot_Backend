import { SupportContent } from '../Models/supportContentModel.js';
import { Feedback } from '../Models/feedbackModel.js';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://192.168.31.186:3002';

// Helper function to ensure full URL
const ensureFullUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

// ==================== ADMIN APIs ====================

// Create or Update Support Content (Admin only)
export const upsertSupportContent = async (req, res) => {
  try {
    let { type, title, content, sections, contactInfo, isActive, targetRole } = req.body;
    const adminId = req.user.userId;

    // Check if admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can manage support content'
      });
    }

    // Parse JSON strings from FormData
    if (typeof sections === 'string') {
      try {
        sections = JSON.parse(sections);
      } catch (e) {
        sections = [];
      }
    }
    
    if (typeof contactInfo === 'string') {
      try {
        contactInfo = JSON.parse(contactInfo);
      } catch (e) {
        contactInfo = {};
      }
    }

    // Handle file attachments
    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map(file => ({
        fileName: file.originalname,
        fileUrl: ensureFullUrl(`/uploads/${file.filename}`),
        fileType: file.mimetype,
        uploadedAt: new Date()
      }));
    }

    // Find existing or create new (by type and targetRole)
    const finalTargetRole = targetRole || 'all';
    let supportContent = await SupportContent.findOne({ type, targetRole: finalTargetRole });

    if (supportContent) {
      // Update existing
      supportContent.title = title || supportContent.title;
      supportContent.content = content || supportContent.content;
      supportContent.sections = sections || supportContent.sections;
      supportContent.contactInfo = contactInfo || supportContent.contactInfo;
      supportContent.isActive = isActive !== undefined ? isActive : supportContent.isActive;
      supportContent.targetRole = finalTargetRole;
      supportContent.lastUpdatedBy = adminId;

      if (attachments.length > 0) {
        supportContent.attachments = [...supportContent.attachments, ...attachments];
      }

      await supportContent.save();
    } else {
      // Create new
      supportContent = new SupportContent({
        type,
        targetRole: finalTargetRole,
        title,
        content,
        sections: sections || [],
        contactInfo: contactInfo || {},
        attachments,
        isActive: isActive !== undefined ? isActive : true,
        lastUpdatedBy: adminId
      });
      await supportContent.save();
    }

    res.status(200).json({
      success: true,
      message: 'Support content saved successfully',
      data: supportContent
    });
  } catch (error) {
    console.error('Upsert support content error:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving support content',
      error: error.message
    });
  }
};

// Delete attachment from support content (Admin only)
export const deleteAttachment = async (req, res) => {
  try {
    const { type, attachmentId } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can manage support content'
      });
    }

    const supportContent = await SupportContent.findOne({ type });
    if (!supportContent) {
      return res.status(404).json({
        success: false,
        message: 'Support content not found'
      });
    }

    supportContent.attachments = supportContent.attachments.filter(
      att => att._id.toString() !== attachmentId
    );
    await supportContent.save();

    res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting attachment',
      error: error.message
    });
  }
};

// Get all support content (Admin only)
export const getAllSupportContent = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can view all support content'
      });
    }

    const contents = await SupportContent.find()
      .populate('lastUpdatedBy', 'name email')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: contents
    });
  } catch (error) {
    console.error('Get all support content error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching support content',
      error: error.message
    });
  }
};

// Get all feedback (Admin only)
export const getAllFeedback = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can view all feedback'
      });
    }

    const { status, type, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (type) query.type = type;

    console.log('📋 Admin fetching feedback with query:', JSON.stringify(query));
    console.log('📋 Pagination:', { page, limit });

    // Try multiple query approaches to find feedback
    const query1 = query;

    console.log('📋 Query 1:', JSON.stringify(query1));

    // First try the standard query
    let feedbacks = await Feedback.find(query1)
      .populate('userId', 'name email role profilePic')
      .populate('adminResponse.respondedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    console.log(`📊 Query 1 result: ${feedbacks.length} feedbacks found`);

    // If no results and status filter is 'pending', try alternative query
    if (feedbacks.length === 0 && status === 'pending') {
      console.log('⚠️ No results with standard query, trying alternative...');
      const allFeedbacks = await Feedback.find({})
        .populate('userId', 'name email role profilePic')
        .populate('adminResponse.respondedBy', 'name email')
        .sort({ createdAt: -1 });

      console.log(`📊 Total feedbacks found: ${allFeedbacks.length}`);

      // Filter manually
      feedbacks = allFeedbacks.filter(feedback => {
        const feedbackStatus = feedback.status;
        console.log(`🔍 Feedback ${feedback._id} (${feedback.subject}): status = ${feedbackStatus}`);
        return feedbackStatus === 'pending';
      });

      console.log(`📊 After manual filter: ${feedbacks.length} pending feedbacks`);

      // Apply pagination to filtered results
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      feedbacks = feedbacks.slice(startIndex, endIndex);
    }

    const total = await Feedback.countDocuments(query);

    console.log('📊 Feedback fetch result:', {
      found: feedbacks.length,
      total,
      query: JSON.stringify(query),
      page,
      limit
    });

    // Log each feedback for debugging
    feedbacks.forEach((feedback, index) => {
      console.log(`📝 Feedback ${index + 1}:`, {
        id: feedback._id.toString(),
        userId: feedback.userId?._id?.toString() || feedback.userId?.toString(),
        userName: feedback.userId?.name || 'N/A',
        type: feedback.type,
        status: feedback.status,
        subject: feedback.subject,
        createdAt: feedback.createdAt
      });
    });

    res.status(200).json({
      success: true,
      data: feedbacks,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalFeedbacks: total
      }
    });
  } catch (error) {
    console.error('❌ Get all feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feedback',
      error: error.message
    });
  }
};

// Respond to feedback (Admin only)
export const respondToFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { message, status } = req.body;
    const adminId = req.user.userId;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can respond to feedback'
      });
    }

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    feedback.adminResponse = {
      message,
      respondedBy: adminId,
      respondedAt: new Date()
    };
    feedback.status = status || 'resolved';
    await feedback.save();

    res.status(200).json({
      success: true,
      message: 'Response sent successfully',
      data: feedback
    });
  } catch (error) {
    console.error('Respond to feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error responding to feedback',
      error: error.message
    });
  }
};

// ==================== USER APIs ====================

// Get support content by type (Public)
export const getSupportContent = async (req, res) => {
  try {
    const { type } = req.params;
    const { role } = req.query; // Get user role from query parameter

    // Build query - prioritize role-specific content, fallback to 'all'
    let supportContent = null;
    if (role && (role === 'teacher' || role === 'student')) {
      // Try to find role-specific content first
      supportContent = await SupportContent.findOne({ 
        type, 
        targetRole: role, 
        isActive: true 
      });
    }
    
    // If no role-specific content found, get 'all' content
    if (!supportContent) {
      supportContent = await SupportContent.findOne({ 
        type, 
        targetRole: 'all', 
        isActive: true 
      });
    }

    if (!supportContent) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        type: supportContent.type,
        title: supportContent.title,
        content: supportContent.content,
        sections: supportContent.sections,
        contactInfo: supportContent.contactInfo,
        attachments: supportContent.attachments,
        updatedAt: supportContent.updatedAt
      }
    });
  } catch (error) {
    console.error('Get support content error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
};

// Submit feedback (User)
export const submitFeedback = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type, subject, message, rating } = req.body;

    console.log('📝 Feedback submission received:', {
      userId,
      type: type || 'general_feedback',
      subject,
      messageLength: message?.length || 0,
      rating,
      hasFiles: !!(req.files && req.files.length > 0)
    });

    // Handle file attachments
    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map(file => ({
        fileName: file.originalname,
        fileUrl: ensureFullUrl(`/uploads/${file.filename}`),
        fileType: file.mimetype
      }));
      console.log('📎 Feedback attachments:', attachments.length);
    }

    const feedback = new Feedback({
      userId,
      type: type || 'general_feedback',
      subject,
      message,
      attachments,
      rating,
      status: 'pending'
    });

    console.log('💾 Saving feedback to database...');
    await feedback.save();
    console.log('✅ Feedback saved successfully:', {
      id: feedback._id.toString(),
      userId: feedback.userId.toString(),
      type: feedback.type,
      status: feedback.status,
      subject: feedback.subject,
      createdAt: feedback.createdAt
    });

    // Verify the save by querying the feedback again
    const savedFeedback = await Feedback.findById(feedback._id);
    if (savedFeedback) {
      console.log('🔍 Verification after save:', {
        id: savedFeedback._id.toString(),
        userId: savedFeedback.userId.toString(),
        status: savedFeedback.status,
        subject: savedFeedback.subject,
        hasMessage: !!savedFeedback.message
      });

      // Also verify with a direct query
      const verifyQuery = {
        _id: feedback._id,
        status: 'pending'
      };
      const verifyResult = await Feedback.findOne(verifyQuery);
      console.log('🔍 Verification query result:', verifyResult ? 'Found' : 'Not found');
    }

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully. Thank you!',
      data: {
        id: feedback._id,
        type: feedback.type,
        subject: feedback.subject,
        status: feedback.status,
        createdAt: feedback.createdAt
      }
    });
  } catch (error) {
    console.error('❌ Submit feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting feedback',
      error: error.message
    });
  }
};

// Get user's own feedback (User)
export const getMyFeedback = async (req, res) => {
  try {
    const userId = req.user.userId;

    const feedbacks = await Feedback.find({ userId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: feedbacks
    });
  } catch (error) {
    console.error('Get my feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feedback',
      error: error.message
    });
  }
};

// Get help center content (convenience endpoint)
export const getHelpCenter = async (req, res) => {
  try {
    const helpContent = await SupportContent.findOne({ type: 'help_center', isActive: true });
    const faqContent = await SupportContent.findOne({ type: 'faq', isActive: true });

    res.status(200).json({
      success: true,
      data: {
        helpCenter: helpContent || null,
        faq: faqContent || null
      }
    });
  } catch (error) {
    console.error('Get help center error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching help center',
      error: error.message
    });
  }
};
