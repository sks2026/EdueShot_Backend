import User from '../Models/userModel.js';
import { createNotification } from './notificationController.js';

// Helper function to generate full URL for uploaded files
const getBaseUrl = () => {
  const defaultUrl = 'http://192.168.31.186:3002';
  return process.env.BASE_URL || defaultUrl;
};

const generateFileUrl = (filename) => {
  if (!filename) return null;
  if (filename.startsWith('http')) return filename;
  return `${getBaseUrl()}/uploads/${filename}`;
};

// Submit verification documents (Teacher only)
export const submitVerificationDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Only teachers can submit verification
    if (userRole !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Only teachers can submit verification documents'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.teacherVerification?.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your account is already verified'
      });
    }

    // Check if verification is pending
    if (user.teacherVerification?.status === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Your verification is already pending review. Please wait 48-72 hours.'
      });
    }

    // Get uploaded files
    const files = req.files;

    if (!files?.aadharFront?.[0] || !files?.aadharBack?.[0] || !files?.panCard?.[0] || !files?.marksheet?.[0]) {
      return res.status(400).json({
        success: false,
        message: 'All documents are required: Aadhar Front, Aadhar Back, PAN Card, and Marksheet',
        received: {
          aadharFront: !!files?.aadharFront?.[0],
          aadharBack: !!files?.aadharBack?.[0],
          panCard: !!files?.panCard?.[0],
          marksheet: !!files?.marksheet?.[0]
        }
      });
    }

    // Update user with verification documents
    // Use set() method to ensure Mongoose detects the change
    if (!user.teacherVerification) {
      user.teacherVerification = {};
    }
    
    user.teacherVerification.status = 'pending';
    user.teacherVerification.aadharFront = files.aadharFront[0].filename;
    user.teacherVerification.aadharBack = files.aadharBack[0].filename;
    user.teacherVerification.panCard = files.panCard[0].filename;
    user.teacherVerification.marksheet = files.marksheet[0].filename;
    user.teacherVerification.submittedAt = new Date();
    user.teacherVerification.reviewedAt = null;
    user.teacherVerification.reviewedBy = null;
    user.teacherVerification.rejectionReason = null;

    // Mark the nested object as modified to ensure MongoDB saves it
    user.markModified('teacherVerification');
    
    console.log('📝 Teacher verification object before save:', JSON.stringify(user.teacherVerification, null, 2));

    console.log('💾 Saving teacher verification:', {
      userId: user._id,
      name: user.name,
      email: user.email,
      status: user.teacherVerification.status,
      submittedAt: user.teacherVerification.submittedAt
    });

    await user.save();

    console.log('✅ Teacher verification saved successfully');
    
    // Verify the save by querying the user again
    const savedUser = await User.findById(userId).select('teacherVerification name email');
    if (savedUser) {
      console.log('🔍 Verification after save:', {
        userId: savedUser._id.toString(),
        name: savedUser.name,
        email: savedUser.email,
        status: savedUser.teacherVerification?.status,
        submittedAt: savedUser.teacherVerification?.submittedAt,
        hasDocuments: !!(savedUser.teacherVerification?.aadharFront)
      });
      
      // Also verify with a direct query
      const verifyQuery = {
        _id: userId,
        'teacherVerification.status': 'pending'
      };
      const verifyResult = await User.findOne(verifyQuery);
      console.log('🔍 Verification query result:', verifyResult ? 'Found with pending status' : 'Not found with pending status');
      
      // Try alternative query approach if standard query fails
      if (!verifyResult) {
        console.log('⚠️ Standard query failed, trying alternative approach...');
        const altVerify = await User.findById(userId);
        if (altVerify) {
          const altStatus = altVerify.teacherVerification?.status;
          console.log('🔍 Alternative query result - Status:', altStatus);
          if (altStatus !== 'pending') {
            console.error('❌ STATUS MISMATCH! Expected "pending" but found:', altStatus);
            console.log('🔍 Full teacherVerification object:', JSON.stringify(altVerify.teacherVerification, null, 2));
          } else {
            console.log('✅ Status is correct in alternative query');
          }
        }
      } else {
        console.log('✅ Verification confirmed - data is queryable');
      }
    }

    // Notify all admins about new verification request
    const admins = await User.find({ role: 'admin', isActive: true });
    for (const admin of admins) {
      await createNotification({
        recipientId: admin._id,
        recipientRole: 'admin',
        type: 'system',
        title: 'New Teacher Verification Request',
        message: `${user.name} has submitted documents for teacher verification. Please review.`,
        fromUserId: userId,
        data: {
          teacherName: user.name,
          teacherEmail: user.email
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Verification documents submitted successfully. Please wait 48-72 hours for review.',
      verification: {
        status: 'pending',
        submittedAt: user.teacherVerification.submittedAt
      }
    });

  } catch (error) {
    console.error('Submit verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get verification status (Teacher only)
export const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select('teacherVerification name email role');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const verification = user.teacherVerification || { status: 'not_submitted' };

    res.status(200).json({
      success: true,
      verification: {
        status: verification.status,
        submittedAt: verification.submittedAt,
        reviewedAt: verification.reviewedAt,
        rejectionReason: verification.rejectionReason,
        documents: verification.status !== 'not_submitted' ? {
          aadharFront: generateFileUrl(verification.aadharFront),
          aadharBack: generateFileUrl(verification.aadharBack),
          panCard: generateFileUrl(verification.panCard),
          marksheet: generateFileUrl(verification.marksheet)
        } : null
      }
    });

  } catch (error) {
    console.error('Get verification status error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get pending verifications (Admin only)
export const getPendingVerifications = async (req, res) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    console.log('🔍 Admin requesting pending verifications:', { userRole, userId });

    if (userRole !== 'admin') {
      console.warn('⚠️ Unauthorized access attempt - user role:', userRole);
      return res.status(403).json({
        success: false,
        message: 'Only admins can view pending verifications'
      });
    }

    console.log('🔍 Querying for pending teacher verifications...');
    
    // Try multiple query approaches to find pending verifications
    const query1 = {
      role: 'teacher',
      'teacherVerification.status': 'pending'
    };
    
    console.log('📋 Query 1:', JSON.stringify(query1));
    
    // First try the standard query
    let pendingTeachers = await User.find(query1)
      .select('name email profilePic teacherVerification createdAt');
    
    console.log(`📊 Query 1 result: ${pendingTeachers.length} teachers found`);
    
    // If no results, try alternative query (in case of nested object issue)
    if (pendingTeachers.length === 0) {
      console.log('⚠️ No results with standard query, trying alternative...');
      const allTeachers = await User.find({ role: 'teacher' })
        .select('name email profilePic teacherVerification createdAt');
      
      console.log(`📊 Total teachers found: ${allTeachers.length}`);
      
      // Filter manually
      pendingTeachers = allTeachers.filter(teacher => {
        const status = teacher.teacherVerification?.status;
        console.log(`🔍 Teacher ${teacher.name} (${teacher.email}): status = ${status}`);
        return status === 'pending';
      });
      
      console.log(`📊 After manual filter: ${pendingTeachers.length} pending teachers`);
    }

    console.log(`✅ Found ${pendingTeachers.length} pending teacher verifications`);

    if (pendingTeachers.length > 0) {
      console.log('📋 Pending teachers:', pendingTeachers.map(t => ({
        id: t._id,
        name: t.name,
        email: t.email,
        status: t.teacherVerification?.status
      })));
    }

    const formattedTeachers = pendingTeachers.map(teacher => ({
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      profilePic: generateFileUrl(teacher.profilePic),
      submittedAt: teacher.teacherVerification?.submittedAt,
      documents: {
        aadharFront: generateFileUrl(teacher.teacherVerification?.aadharFront),
        aadharBack: generateFileUrl(teacher.teacherVerification?.aadharBack),
        panCard: generateFileUrl(teacher.teacherVerification?.panCard),
        marksheet: generateFileUrl(teacher.teacherVerification?.marksheet)
      }
    }));

    console.log('✅ Sending response with', formattedTeachers.length, 'pending teachers');

    res.status(200).json({
      success: true,
      count: formattedTeachers.length,
      teachers: formattedTeachers
    });

  } catch (error) {
    console.error('❌ Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get all verifications with filter (Admin only)
export const getAllVerifications = async (req, res) => {
  try {
    const userRole = req.user?.role;
    const { status } = req.query; // pending, approved, rejected, not_submitted

    console.log('🔍 Admin requesting all verifications:', { userRole, status });

    if (userRole !== 'admin') {
      console.warn('⚠️ Unauthorized access attempt - user role:', userRole);
      return res.status(403).json({
        success: false,
        message: 'Only admins can view verifications'
      });
    }

    let query = { role: 'teacher' };
    if (status && status !== 'all') {
      query['teacherVerification.status'] = status;
    }

    console.log('🔍 Query for teachers:', JSON.stringify(query));

    let teachers = await User.find(query)
      .select('name email profilePic teacherVerification createdAt')
      .sort({ 'teacherVerification.submittedAt': -1 });

    console.log(`📊 Standard query result: ${teachers.length} teachers found with status: ${status || 'all'}`);

    // If filtering by status and no results, try alternative approach
    if (status && status !== 'all' && teachers.length === 0) {
      console.log('⚠️ No results with standard query, trying alternative approach...');
      const allTeachers = await User.find({ role: 'teacher' })
        .select('name email profilePic teacherVerification createdAt');
      
      console.log(`📊 Total teachers in database: ${allTeachers.length}`);
      
      // Log all teachers' verification status for debugging
      allTeachers.forEach(teacher => {
        const teacherStatus = teacher.teacherVerification?.status || 'not_set';
        console.log(`  - ${teacher.name} (${teacher.email}): verification status = "${teacherStatus}"`);
      });
      
      // Filter manually
      teachers = allTeachers.filter(teacher => {
        const teacherStatus = teacher.teacherVerification?.status || 'not_submitted';
        return teacherStatus === status;
      });
      
      console.log(`📊 After manual filter: ${teachers.length} teachers with status "${status}"`);
    }

    console.log(`✅ Final result: ${teachers.length} teachers with status: ${status || 'all'}`);

    const formattedTeachers = teachers.map(teacher => ({
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      profilePic: generateFileUrl(teacher.profilePic),
      verificationStatus: teacher.teacherVerification?.status || 'not_submitted',
      submittedAt: teacher.teacherVerification?.submittedAt,
      reviewedAt: teacher.teacherVerification?.reviewedAt,
      rejectionReason: teacher.teacherVerification?.rejectionReason,
      documents: teacher.teacherVerification?.aadharFront ? {
        aadharFront: generateFileUrl(teacher.teacherVerification.aadharFront),
        aadharBack: generateFileUrl(teacher.teacherVerification.aadharBack),
        panCard: generateFileUrl(teacher.teacherVerification.panCard),
        marksheet: generateFileUrl(teacher.teacherVerification.marksheet)
      } : null
    }));

    console.log('✅ Sending response with', formattedTeachers.length, 'teachers');

    res.status(200).json({
      success: true,
      count: formattedTeachers.length,
      teachers: formattedTeachers
    });

  } catch (error) {
    console.error('❌ Get all verifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Approve teacher verification (Admin only)
export const approveVerification = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const userRole = req.user.role;
    const { teacherId } = req.params;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can approve verifications'
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

    if (teacher.teacherVerification?.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending verification request found'
      });
    }

    // Approve verification
    teacher.teacherVerification.status = 'approved';
    teacher.teacherVerification.reviewedAt = new Date();
    teacher.teacherVerification.reviewedBy = adminId;
    teacher.teacherVerification.rejectionReason = null;

    // Mark the nested object as modified to ensure MongoDB saves it
    teacher.markModified('teacherVerification');

    await teacher.save();

    // Notify teacher about approval
    await createNotification({
      recipientId: teacherId,
      recipientRole: 'teacher',
      type: 'system',
      title: 'Verification Approved!',
      message: 'Congratulations! Your teacher verification has been approved. Your courses are now visible to students.',
      fromUserId: adminId
    });

    res.status(200).json({
      success: true,
      message: 'Teacher verification approved successfully',
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        verificationStatus: 'approved'
      }
    });

  } catch (error) {
    console.error('Approve verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Reject teacher verification (Admin only)
export const rejectVerification = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const userRole = req.user.role;
    const { teacherId } = req.params;
    const { reason } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can reject verifications'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
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

    if (teacher.teacherVerification?.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending verification request found'
      });
    }

    // Reject verification
    teacher.teacherVerification.status = 'rejected';
    teacher.teacherVerification.reviewedAt = new Date();
    teacher.teacherVerification.reviewedBy = adminId;
    teacher.teacherVerification.rejectionReason = reason;

    // Mark the nested object as modified to ensure MongoDB saves it
    teacher.markModified('teacherVerification');

    await teacher.save();

    // Notify teacher about rejection
    await createNotification({
      recipientId: teacherId,
      recipientRole: 'teacher',
      type: 'system',
      title: 'Verification Rejected',
      message: `Your verification was rejected. Reason: ${reason}. Please resubmit with correct documents.`,
      fromUserId: adminId
    });

    res.status(200).json({
      success: true,
      message: 'Teacher verification rejected',
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        verificationStatus: 'rejected',
        rejectionReason: reason
      }
    });

  } catch (error) {
    console.error('Reject verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ========== STUDENT VERIFICATION FUNCTIONS ==========

// Submit student verification documents (Student only)
export const submitStudentVerificationDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Only students can submit verification
    if (userRole !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only students can submit verification documents'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.studentVerification?.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your account is already verified'
      });
    }

    // Check if verification is pending
    if (user.studentVerification?.status === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Your verification is already pending review. Please wait 48-72 hours.'
      });
    }

    // Get uploaded files
    const files = req.files;

    if (!files?.aadharFront?.[0] || !files?.aadharBack?.[0] || !files?.studentId?.[0] || !files?.marksheet?.[0]) {
      return res.status(400).json({
        success: false,
        message: 'All documents are required: Aadhar Front, Aadhar Back, Student ID, and Marksheet',
        received: {
          aadharFront: !!files?.aadharFront?.[0],
          aadharBack: !!files?.aadharBack?.[0],
          studentId: !!files?.studentId?.[0],
          marksheet: !!files?.marksheet?.[0]
        }
      });
    }

    // Update user with verification documents
    // Update user with verification documents
    // Use individual field assignment to ensure Mongoose detects the change
    if (!user.studentVerification) {
      user.studentVerification = {};
    }
    
    user.studentVerification.status = 'pending';
    user.studentVerification.aadharFront = files.aadharFront[0].filename;
    user.studentVerification.aadharBack = files.aadharBack[0].filename;
    user.studentVerification.studentId = files.studentId[0].filename;
    user.studentVerification.marksheet = files.marksheet[0].filename;
    user.studentVerification.submittedAt = new Date();
    user.studentVerification.reviewedAt = null;
    user.studentVerification.reviewedBy = null;
    user.studentVerification.rejectionReason = null;

    // Mark the nested object as modified to ensure MongoDB saves it
    user.markModified('studentVerification');
    
    console.log('📝 Student verification object before save:', JSON.stringify(user.studentVerification, null, 2));

    await user.save();

    // Notify all admins about new verification request
    const admins = await User.find({ role: 'admin', isActive: true });
    for (const admin of admins) {
      await createNotification({
        recipientId: admin._id,
        recipientRole: 'admin',
        type: 'system',
        title: 'New Student Verification Request',
        message: `${user.name} has submitted documents for student verification. Please review.`,
        fromUserId: userId,
        data: {
          studentName: user.name,
          studentEmail: user.email
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Verification documents submitted successfully. Please wait 48-72 hours for review.',
      verification: {
        status: 'pending',
        submittedAt: user.studentVerification.submittedAt
      }
    });

  } catch (error) {
    console.error('Submit student verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get student verification status (Student only)
export const getStudentVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select('studentVerification name email role');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const verification = user.studentVerification || { status: 'not_submitted' };

    res.status(200).json({
      success: true,
      verification: {
        status: verification.status,
        submittedAt: verification.submittedAt,
        reviewedAt: verification.reviewedAt,
        rejectionReason: verification.rejectionReason,
        documents: verification.status !== 'not_submitted' ? {
          aadharFront: generateFileUrl(verification.aadharFront),
          aadharBack: generateFileUrl(verification.aadharBack),
          studentId: generateFileUrl(verification.studentId),
          marksheet: generateFileUrl(verification.marksheet)
        } : null
      }
    });

  } catch (error) {
    console.error('Get student verification status error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get pending student verifications (Admin only)
export const getPendingStudentVerifications = async (req, res) => {
  try {
    const userRole = req.user.role;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view pending verifications'
      });
    }

    const pendingStudents = await User.find({
      role: 'student',
      'studentVerification.status': 'pending'
    }).select('name email profilePic studentVerification createdAt');

    const formattedStudents = pendingStudents.map(student => ({
      _id: student._id,
      name: student.name,
      email: student.email,
      profilePic: generateFileUrl(student.profilePic),
      submittedAt: student.studentVerification.submittedAt,
      documents: {
        aadharFront: generateFileUrl(student.studentVerification.aadharFront),
        aadharBack: generateFileUrl(student.studentVerification.aadharBack),
        studentId: generateFileUrl(student.studentVerification.studentId),
        marksheet: generateFileUrl(student.studentVerification.marksheet)
      }
    }));

    res.status(200).json({
      success: true,
      count: formattedStudents.length,
      students: formattedStudents
    });

  } catch (error) {
    console.error('Get pending student verifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get all student verifications with filter (Admin only)
export const getAllStudentVerifications = async (req, res) => {
  try {
    const userRole = req.user.role;
    const { status } = req.query; // pending, approved, rejected, not_submitted

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view verifications'
      });
    }

    let query = { role: 'student' };
    if (status && status !== 'all') {
      query['studentVerification.status'] = status;
    }

    const students = await User.find(query)
      .select('name email profilePic studentVerification createdAt')
      .sort({ 'studentVerification.submittedAt': -1 });

    const formattedStudents = students.map(student => ({
      _id: student._id,
      name: student.name,
      email: student.email,
      profilePic: generateFileUrl(student.profilePic),
      verificationStatus: student.studentVerification?.status || 'not_submitted',
      submittedAt: student.studentVerification?.submittedAt,
      reviewedAt: student.studentVerification?.reviewedAt,
      rejectionReason: student.studentVerification?.rejectionReason,
      documents: student.studentVerification?.aadharFront ? {
        aadharFront: generateFileUrl(student.studentVerification.aadharFront),
        aadharBack: generateFileUrl(student.studentVerification.aadharBack),
        studentId: generateFileUrl(student.studentVerification.studentId),
        marksheet: generateFileUrl(student.studentVerification.marksheet)
      } : null
    }));

    res.status(200).json({
      success: true,
      count: formattedStudents.length,
      students: formattedStudents
    });

  } catch (error) {
    console.error('Get all student verifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Approve student verification (Admin only)
export const approveStudentVerification = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const userRole = req.user.role;
    const { studentId } = req.params;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can approve verifications'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    if (student.role !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'User is not a student'
      });
    }

    if (student.studentVerification?.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending verification request found'
      });
    }

    // Approve verification
    student.studentVerification.status = 'approved';
    student.studentVerification.reviewedAt = new Date();
    student.studentVerification.reviewedBy = adminId;
    student.studentVerification.rejectionReason = null;

    // Mark the nested object as modified to ensure MongoDB saves it
    student.markModified('studentVerification');

    await student.save();

    // Notify student about approval
    await createNotification({
      recipientId: studentId,
      recipientRole: 'student',
      type: 'system',
      title: 'Verification Approved!',
      message: 'Congratulations! Your student verification has been approved.',
      fromUserId: adminId
    });

    res.status(200).json({
      success: true,
      message: 'Student verification approved successfully',
      student: {
        _id: student._id,
        name: student.name,
        email: student.email,
        verificationStatus: 'approved'
      }
    });

  } catch (error) {
    console.error('Approve student verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Reject student verification (Admin only)
export const rejectStudentVerification = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const userRole = req.user.role;
    const { studentId } = req.params;
    const { reason } = req.body;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can reject verifications'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    if (student.role !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'User is not a student'
      });
    }

    if (student.studentVerification?.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending verification request found'
      });
    }

    // Reject verification
    student.studentVerification.status = 'rejected';
    student.studentVerification.reviewedAt = new Date();
    student.studentVerification.reviewedBy = adminId;
    student.studentVerification.rejectionReason = reason;

    // Mark the nested object as modified to ensure MongoDB saves it
    student.markModified('studentVerification');

    await student.save();

    // Notify student about rejection
    await createNotification({
      recipientId: studentId,
      recipientRole: 'student',
      type: 'system',
      title: 'Verification Rejected',
      message: `Your verification was rejected. Reason: ${reason}. Please resubmit with correct documents.`,
      fromUserId: adminId
    });

    res.status(200).json({
      success: true,
      message: 'Student verification rejected',
      student: {
        _id: student._id,
        name: student.name,
        email: student.email,
        verificationStatus: 'rejected',
        rejectionReason: reason
      }
    });

  } catch (error) {
    console.error('Reject student verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};