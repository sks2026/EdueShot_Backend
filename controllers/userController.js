import User from '../Models/userModel.js';
import AdminNotification from '../Models/adminNotificationModel.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../Middleware/userAuth.js';
import sendEmail from '../Common/nodeMailer.js';

// Password validation helper
// Allowed special characters: @$!%*?&
const validatePassword = (password) => {
  const errors = [];
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[@$!%*?&]/.test(password)) {
    errors.push('Password must contain at least one special character (@$!%*?&)');
  }
  return errors;
};

// Email normalization helper
const normalizeEmail = (email) => email.toLowerCase().trim();


// Register user with OTP verification
const register = async (req, res) => {
  try {
    const { name, password, role, otp } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : null;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password and role are required"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    // Validate password strength
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordErrors
      });
    }

    // Check if user already exists with same email AND role and is verified
    const existingVerifiedUser = await User.findOne({ email, role, isVerified: true });
    if (existingVerifiedUser) {
      return res.status(400).json({
        success: false,
        message: `User already exists with this email as ${role}. Please use login instead.`
      });
    }

    // Find pending user (either with OTP or already verified OTP) for this email + role combination
    let pendingUser = null;

    // If OTP is provided, verify it and complete registration
    if (otp) {
      // Find pending user with matching OTP for this email + role
      pendingUser = await User.findOne({
        email,
        role,
        otp,
        otpExpires: { $gt: new Date() },
        isVerified: false
      });

      if (!pendingUser) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP. Please request a new OTP."
        });
      }
    } else {
      // If no OTP provided, check if user has a pending account with valid OTP for this email + role
      // This allows registration after verifyOTP was called separately
      pendingUser = await User.findOne({
        email,
        role,
        isVerified: false,
        otpExpires: { $gt: new Date() }
      });

      if (!pendingUser) {
        return res.status(400).json({
          success: false,
          message: "Please verify your email with OTP before completing registration. Either provide OTP in this request or verify OTP first using /api/users/verify endpoint."
        });
      }

      // If OTP exists but wasn't provided, still allow registration (OTP already verified via /verify endpoint)
      console.log('Registration without OTP - user has pending account with valid OTP');
    }

    console.log('Found pending user for registration:', email);
    if (otp) {
      console.log('Pending user OTP:', pendingUser.otp);
      console.log('Provided OTP:', otp);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update pending user to complete registration with verified status
    pendingUser.name = name;
    pendingUser.password = hashedPassword;
    pendingUser.role = role;
    pendingUser.isVerified = true;
    pendingUser.otp = null;
    pendingUser.otpExpires = null;
    // Ensure forgot password fields are also cleared
    pendingUser.forgotPasswordOtp = null;
    pendingUser.forgotPasswordExpiry = null;
    
    await pendingUser.save();
    
    // Verify the user was saved correctly
    const savedUser = await User.findById(pendingUser._id);
    console.log('User registration completed and verified:', email);
    console.log('User isVerified status in memory:', pendingUser.isVerified);
    console.log('User isVerified status in database:', savedUser.isVerified);
    console.log('User saved successfully:', !!savedUser);
    
    // Security: Ensure OTP fields are cleared for verified users
    if (savedUser && savedUser.isVerified) {
      console.log('🔒 Security: Ensuring OTP fields are cleared for verified user');
      if (savedUser.otp || savedUser.otpExpires || savedUser.forgotPasswordOtp || savedUser.forgotPasswordExpiry) {
        console.log('⚠️ Warning: OTP fields still exist for verified user, clearing them...');
        await User.findByIdAndUpdate(savedUser._id, {
          otp: null,
          otpExpires: null,
          forgotPasswordOtp: null,
          forgotPasswordExpiry: null
        });
        console.log('✅ OTP fields cleared for verified user');
      }
    }

    const userResponse = {
      _id: pendingUser._id,
      name: pendingUser.name,
      email: pendingUser.email,
      role: pendingUser.role,
      isVerified: pendingUser.isVerified,
      createdAt: pendingUser.createdAt
    };

    return res.status(201).json({ 
      success: true, 
      message: "User registered and email verified successfully!",
      user: userResponse,
    });
  
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({ 
        success: false, 
        message: "Internal server error during registration",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }


//send otp
const sendOtp = async (req, res) => {
  try {
    const email = req.body.email ? normalizeEmail(req.body.email) : null;
    const { role } = req.body;

    // 1️⃣ Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Validate role
    if (!role || !['teacher', 'student'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher' or 'student'"
      });
    }

    // 2️⃣ Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    // 3️⃣ CRITICAL: Check if user already exists with same email AND role and is verified
    const existingVerifiedUser = await User.findOne({ email, role, isVerified: true });
    if (existingVerifiedUser) {
      console.log('🚫 OTP request BLOCKED for verified user:', email, 'role:', role);
      console.log('✅ Verified user details:', {
        id: existingVerifiedUser._id,
        name: existingVerifiedUser.name,
        email: existingVerifiedUser.email,
        role: existingVerifiedUser.role,
        isVerified: existingVerifiedUser.isVerified,
        createdAt: existingVerifiedUser.createdAt,
        verifiedAt: existingVerifiedUser.updatedAt
      });
      console.log('🔒 Security: Verified users cannot request OTP for verification');

      return res.status(400).json({
        success: false,
        message: `This email is already verified and registered as ${role}. OTP verification is not needed. Please use login instead.`,
        userExists: true,
        isVerified: true,
        reason: "User already verified - OTP not allowed"
      });
    }

    // 4️⃣ Generate a new OTP (valid for 10 minutes)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    console.log('Generated OTP for', email, 'role:', role, ':', otp);
    console.log('OTP expires at:', otpExpires);

    // 5️⃣ Create or update pending user record for this email + role combination
    let pendingUser = await User.findOne({ email, role, isVerified: false });

    if (pendingUser) {
      // Update existing pending user with new OTP
      pendingUser.otp = otp;
      pendingUser.otpExpires = otpExpires;
      // Clear forgot password fields during registration
      pendingUser.forgotPasswordOtp = null;
      pendingUser.forgotPasswordExpiry = null;
      await pendingUser.save();
      console.log('Updated existing pending user with new OTP');
      console.log('Updated user ID:', pendingUser._id);
      console.log('Updated user isVerified:', pendingUser.isVerified);
    } else {
      // Create new pending user for email verification
      pendingUser = new User({
        email,
        role,
        otp,
        otpExpires,
        forgotPasswordOtp: null,
        forgotPasswordExpiry: null,
        isVerified: false
      });
      await pendingUser.save();
      console.log('Created new pending user for email verification');
      console.log('New user ID:', pendingUser._id);
      console.log('New user role:', pendingUser.role);
      console.log('New user isVerified:', pendingUser.isVerified);
    }

    // 6️⃣ Send OTP email
    const subject = "Welcome to EduSpark - Email Verification OTP";
    const text = `Welcome to EduSpark!\n\nYour OTP for email verification is: ${otp}\n\nThis code will expire in 10 minutes.\n\nUse this OTP to complete your new account registration.\n\nIf you didn't create an account with EduSpark, please ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #667eea; margin: 0;">Welcome to EduSpark!</h1>
        </div>
        
        <h2 style="color: #333;">Email Verification Required</h2>
        <p>Thank you for starting your registration with EduSpark. To complete your account setup, please verify your email address using the OTP below:</p>
        
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 25px; text-align: center; margin: 25px 0; border-radius: 12px;">
          <h1 style="letter-spacing: 8px; color: white; margin: 0; font-size: 2.5em;">${otp}</h1>
        </div>
        
        <p><strong>Important:</strong></p>
        <ul style="color: #555;">
          <li>This code is valid for <strong>10 minutes</strong></li>
          <li>Enter this OTP in the registration form to complete your account</li>
          <li>Do not share this code with anyone</li>
        </ul>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px; text-align: center;">
          If you didn't create an account with EduSpark, please ignore this email.<br>
          This is an automated message, please do not reply.
        </p>
      </div>
    `;

    console.log('Attempting to send email to:', email);
    await sendEmail(email, subject, text, html);
    console.log('Email sent successfully to:', email);

    return res.status(200).json({
      success: true,
      message: "OTP has been sent to your email address. Please check your inbox to complete registration."
    });

  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while sending OTP",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

  

// Login user - Only verified users allowed
const login = async (req, res) => {
  try {
    const { password, role } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : null;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Validate role
    if (!role || !['teacher', 'student', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher', 'student', or 'admin'"
      });
    }

    // SECURITY: Block admin login from app - Admin can only login through admin panel
    if (role === 'admin') {
      console.log('🚫 Admin login attempt blocked from app endpoint:', email);
      return res.status(403).json({
        success: false,
        message: 'Admin login is not allowed through this endpoint. Please use the admin panel to login.',
        adminLoginRequired: true,
        adminPanelUrl: '/admin/login'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: `Invalid email or password for ${role} account`
      });
    }

    // CRITICAL: Check if user is verified - Only verified users can login
    if (!user.isVerified) {
      console.log('Login attempt by unverified user:', email);
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete your registration by verifying your email address.',
        requiresVerification: true
      });
    }

    // Check if account is active (soft delete check)
    if (!user.isActive) {
      console.log('Login attempt by inactive user:', email);
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support for assistance.',
        accountDeactivated: true
      });
    }

    // Check if account deletion is pending
    if (user.deletionRequested && user.deletionStatus === 'pending') {
      console.log('Login by user with pending deletion request:', email);
      // Allow login but warn user
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('Invalid password attempt for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT tokens for verified user
    // Access token: 7 days for better mobile app experience
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, type: 'access' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // Refresh token: 30 days for seamless re-authentication
    const refreshToken = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, type: 'refresh' },
      getJwtSecret(),
      { expiresIn: '30d' }
    );

    console.log('Successful login for verified user:', email);

    res.json({
      success: true,
      message: 'Login successful',
      token: accessToken,
      refreshToken,
      expiresIn: 604800, // 7 days in seconds
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        canCreatePaidQuiz: user.canCreatePaidQuiz || false,
        profilePic: user.profilePic || null,
        mobile: user.mobile || null
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const verifyOTP = async (request, response) => {
  try {
    const { email, otp, role } = request.body;

    if (!email || !otp) {
      return response.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    // Validate role
    if (!role || !['teacher', 'student'].includes(role)) {
      return response.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher' or 'student'"
      });
    }

    // Find pending user with matching OTP for this email + role
    const pendingUser = await User.findOne({
      email: email,
      role: role,
      otp: otp,
      otpExpires: { $gt: new Date() },
      isVerified: false
    });

    if (!pendingUser) {
      return response.status(400).json({
        success: false,
        message: "Invalid or expired OTP. Please request a new OTP."
      });
    }

    console.log('OTP verification successful for:', email, 'role:', role);
    console.log('User ready for registration completion');

    // Return success - user can now complete registration
    return response.status(200).json({
      success: true,
      message: "OTP verified successfully. You can now complete your registration.",
      email: email,
      role: role,
      verified: true
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    return response.status(500).json({
      success: false,
      message: "Internal server error during OTP verification",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
// OTP functions removed - no longer needed

const resendOTP = async (req, res) => {
  try {
    console.log('Resend OTP request received:', req.body);

    const { email, role } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Validate role
    if (!role || !['teacher', 'student'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher' or 'student'"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      console.log('User not found for resend OTP:', email, 'role:', role);
      return res.status(404).json({
        success: false,
        message: `User not found with this email as ${role}`
      });
    }

    // Check if user is already verified - NO OTP resend for verified users
    if (user.isVerified) {
      console.log('🚫 Resend OTP request BLOCKED for verified user:', email, 'role:', role);
      console.log('✅ Verified user details:', {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        verifiedAt: user.updatedAt
      });
      console.log('🔒 Security: Verified users cannot resend OTP for verification');

      return res.status(400).json({
        success: false,
        message: `User is already verified as ${role}. OTP resend is not allowed for verified users.`,
        userExists: true,
        isVerified: true,
        reason: "User already verified - OTP resend not allowed"
      });
    }
    
    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    console.log('Generated new OTP for resend:', email, ':', otp);
    console.log('OTP expires at:', otpExpires);

      // Update user with new OTP
      user.otp = otp;
      user.otpExpires = otpExpires;
      // Clear forgot password fields during registration resend
      user.forgotPasswordOtp = null;
      user.forgotPasswordExpiry = null;
    await user.save();

    // TODO: Uncomment when email service is ready
    // await sendOtpEmail(email, otp, {
    //   subject: 'Verify your account (resend OTP)',
    //   text: `Your OTP is: ${otp}. It is valid for 10 minutes.`,
    //   html: `<p>Your OTP is: <b>${otp}</b></p><p>It is valid for 10 minutes.</p>`
    // });

    console.log('Resend OTP saved for user:', email);

    return res.status(200).json({ 
      success: true, 
      message: 'OTP resent to your email address',
      // In development, you might want to include the OTP for testing
      ...(process.env.NODE_ENV === 'development' && { otp: otp })
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error during OTP resend',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
// Get user profile by ID (public route)
const getProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await User.findById(userId).select('-password -otp -otpExpires');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get current user's profile (authenticated route)
const getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.userId;
    
    const user = await User.findById(userId).select('-password -otp -otpExpires');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.userId; // Get user ID from JWT token
    const { name, email, mobile, profilePic } = req.body;

    // Validation - at least one field must be provided
    if (!name && !email && !mobile && profilePic === undefined) {
      return res.status(400).json({
        success: false,
        message: 'At least one field (name, email, mobile or profilePic) must be provided for update'
      });
    }

    // Validate email format if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }
    }

    // Validate mobile format if mobile is being updated
    if (mobile) {
      const mobileRegex = /^[6-9]\d{9}$/;
      if (!mobileRegex.test(mobile)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid 10-digit mobile number'
        });
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email already exists for the same role (if email is being updated)
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email, role: user.role });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: `Email already exists for ${user.role}. Please use a different email address`
        });
      }
    }

    // Update only the provided fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (mobile !== undefined) user.mobile = mobile;
    if (profilePic !== undefined) user.profilePic = profilePic;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
        profilePic: user.profilePic,
        isVerified: user.isVerified,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during profile update'
    });
  }
};

// Update any user profile by ID (public route - for admin use)
const updateUserProfile = async (req, res) => {
  try {
    console.log('updateUserProfile called with params:', req.params);
    console.log('updateUserProfile called with body:', req.body);

    const userId = req.params.id;
    const { name, email } = req.body;

    // Validation - at least one field must be provided
    if (!name && !email) {
      return res.status(400).json({
        success: false,
        message: 'At least one field (name or email) must be provided for update'
      });
    }

    // Validate email format if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email already exists for the same role (if email is being updated)
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email, role: user.role });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: `Email already exists for ${user.role}. Please use a different email address`
        });
      }
    }

    // Update only the provided fields
    if (name) user.name = name;
    if (email) user.email = email;

    await user.save();

    res.json({
      success: true,
      message: 'User profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during profile update'
    });
  }
};

// Forgot password - Send OTP to verified users only
const forgotPassword = async (req, res) => {
  try {
    const { email, role } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Validate role
    if (!role || !['teacher', 'student', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher', 'student', or 'admin'"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      // Check if email exists with a different role
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(404).json({
          success: false,
          message: `This email is registered as ${existingUser.role}, not as ${role}. Please go back and select the correct role.`
        });
      }
      return res.status(404).json({
        success: false,
        message: `No account found with this email address`
      });
    }

    // CRITICAL: Only verified users can reset password
    if (!user.isVerified) {
      console.log('Password reset attempt by unverified user:', email);
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete your registration first.',
        requiresVerification: true
      });
    }

    // Generate OTP for password reset
    const forgotPasswordOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const forgotPasswordExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    console.log('Generated forgot password OTP for', email, ':', forgotPasswordOtp);
    console.log('OTP expires at:', forgotPasswordExpiry);

    // Update user with forgot password OTP
    user.forgotPasswordOtp = forgotPasswordOtp;
    user.forgotPasswordExpiry = forgotPasswordExpiry;
    // Clear regular OTP fields when using forgot password
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    // Send password reset OTP email
    const subject = "EduSpark - Password Reset OTP";
    const text = `Password Reset Request\n\nYour OTP for password reset is: ${forgotPasswordOtp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request a password reset, please ignore this email.\n\nBest regards,\nEduSpark Team`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #667eea; margin: 0;">EduSpark</h1>
        </div>
        
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>We received a request to reset your password. Use the OTP below to complete the password reset:</p>
        
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 25px; text-align: center; margin: 25px 0; border-radius: 12px;">
          <h1 style="letter-spacing: 8px; color: white; margin: 0; font-size: 2.5em;">${forgotPasswordOtp}</h1>
        </div>
        
        <p><strong>Important:</strong></p>
        <ul style="color: #555;">
          <li>This code is valid for <strong>10 minutes</strong></li>
          <li>Enter this OTP to complete your password reset</li>
          <li>Do not share this code with anyone</li>
        </ul>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px; text-align: center;">
          If you didn't request a password reset, please ignore this email.<br>
          This is an automated message, please do not reply.
        </p>
      </div>
    `;
    
    console.log('Attempting to send password reset email to:', email);
    await sendEmail(email, subject, text, html);
    console.log('Password reset email sent successfully to:', email);

    console.log('Password reset OTP saved for user:', email);

    return res.status(200).json({
      success: true,
      message: 'Password reset OTP sent to your email address',
      // In development, you might want to include the OTP for testing
      ...(process.env.NODE_ENV === 'development' && { otp: forgotPasswordOtp })
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during password reset',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

const verifyPasswordResetOTP = async (req, res) => {
  try {
    const { email, otp, role } = req.body;

    // Validation
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Validate role
    if (!role || !['teacher', 'student', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher', 'student', or 'admin'"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      // Check if email exists with a different role
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(404).json({
          success: false,
          message: `This email is registered as ${existingUser.role}, not as ${role}. Please go back and select the correct role.`
        });
      }
      return res.status(404).json({
        success: false,
        message: `No account found with this email address`
      });
    }

    // CRITICAL: Only verified users can verify password reset OTP
    if (!user.isVerified) {
      console.log('Password reset OTP verification attempt by unverified user:', email);
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete your registration first.',
        requiresVerification: true
      });
    }

    // Check if user has a valid forgot password OTP
    if (!user.forgotPasswordOtp || !user.forgotPasswordExpiry) {
      return res.status(400).json({
        success: false,
        message: 'No password reset request found. Please request a new password reset.'
      });
    }

    // Check if OTP is expired
    const currentTime = new Date();
    if (user.forgotPasswordExpiry < currentTime) {
      console.log('Password reset OTP expired for user:', email);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new password reset.'
      });
    }

    // Verify OTP
    if (otp !== user.forgotPasswordOtp) {
      console.log('Invalid password reset OTP attempt for user:', email);
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check and try again.'
      });
    }

    // Clear the forgot password OTP fields after successful verification
    user.forgotPasswordOtp = "";
    user.forgotPasswordExpiry = "";
    await user.save();

    console.log('Password reset OTP verified successfully for user:', email);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      email: user.email
    });

  } catch (error) {
    console.error('Verify password reset OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during OTP verification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword, role } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : null;

    // Validation
    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, new password, and confirm password are required'
      });
    }

    // Validate role
    if (!role || !['teacher', 'student', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be 'teacher', 'student', or 'admin'"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Validate password strength
    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Password does not meet requirements',
        errors: passwordErrors
      });
    }

    // Check if passwords match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // Find user by email and role
    const user = await User.findOne({ email, role });
    if (!user) {
      // Check if email exists with a different role
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(404).json({
          success: false,
          message: `This email is registered as ${existingUser.role}, not as ${role}. Please go back and select the correct role.`
        });
      }
      return res.status(404).json({
        success: false,
        message: `No account found with this email address`
      });
    }

    // CRITICAL: Only verified users can reset password
    if (!user.isVerified) {
      console.log('Password reset attempt by unverified user:', email);
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please complete your registration first.',
        requiresVerification: true
      });
    }

    // SECURITY: Check if user has a valid forgot password OTP that hasn't been verified yet
    // If OTP exists and hasn't expired, user needs to verify it first
    if (user.forgotPasswordOtp && user.forgotPasswordOtp !== "" && user.forgotPasswordExpiry) {
      const currentTime = new Date();
      if (user.forgotPasswordExpiry > currentTime) {
        console.log('Password reset attempt without OTP verification for user:', email);
        console.log('User OTP status:', {
          forgotPasswordOtp: user.forgotPasswordOtp,
          forgotPasswordExpiry: user.forgotPasswordExpiry,
          isExpired: user.forgotPasswordExpiry <= currentTime
        });
        return res.status(400).json({
          success: false,
          message: 'Please verify OTP first before resetting password'
        });
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password and ensure all OTP fields are cleared
    user.password = hashedPassword;
    user.forgotPasswordOtp = "";
    user.forgotPasswordExpiry = "";
    // Also clear regular OTP fields for security
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    console.log('Password reset successful for user:', email);

    return res.status(200).json({
      success: true,
      message: 'Password reset successful',
      email: user.email
    });

  } catch (error) {
    console.error('Reset password error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error during password reset',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
//delete user profile
const deleteUserProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    await User.findByIdAndDelete(userId);
    res.json({ success: true, message: 'User profile deleted successfully' });
  } catch (error) {
    console.error('Delete user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during profile deletion'
    });
  }
}

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json({ success: true, users });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Internal server error during users retrieval' });
  }
}

// Refresh token endpoint
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Refresh token expired. Please login again.'
        });
      }
      return res.status(403).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Check if it's actually a refresh token
    if (decoded.type !== 'refresh') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Find user to ensure they still exist
    const user = await User.findById(decoded.userId);
    if (!user || !user.isVerified) {
      return res.status(401).json({
        success: false,
        message: 'User not found or not verified'
      });
    }

    // SECURITY: Block admin refresh token from app - Admin should use admin panel
    if (user.role === 'admin') {
      console.log('🚫 Admin refresh token attempt blocked from app endpoint:', user.email);
      return res.status(403).json({
        success: false,
        message: 'Admin access is not allowed through this endpoint. Please use the admin panel.',
        adminLoginRequired: true
      });
    }

    // Generate new access token (7 days for mobile app)
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, type: 'access' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token: accessToken,
      expiresIn: 604800 // 7 days in seconds
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during token refresh'
    });
  }
};

// Logout endpoint (for future token blacklisting)
const logout = async (req, res) => {
  try {
    // For now, just return success - client will remove tokens
    // In production, you might want to blacklist the token
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during logout'
    });
  }
};

// Upload profile picture
const uploadProfilePic = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No profile picture uploaded'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get BASE_URL from environment
    const BASE_URL = process.env.BASE_URL || 'http://192.168.31.186:3002';
    const profilePicUrl = `${BASE_URL}/uploads/${req.file.filename}`;

    // Update user profile pic
    user.profilePic = profilePicUrl;
    await user.save();

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      url: profilePicUrl,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
        profilePic: user.profilePic,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('Upload profile pic error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during profile picture upload'
    });
  }
};

// ============================================
// SOFT DELETE / ACCOUNT DELETION FUNCTIONS
// ============================================

// Request account deletion (for students and teachers)
const requestAccountDeletion = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { reason, password } = req.body;

    // Validation
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a reason for account deletion (minimum 10 characters)'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your password to confirm account deletion request'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password. Please enter correct password to confirm.'
      });
    }

    // Check if already requested
    if (user.deletionRequested && user.deletionStatus === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Account deletion request already pending. Please wait for admin review.',
        requestedAt: user.deletionRequestedAt
      });
    }

    // Update user with deletion request
    user.deletionRequested = true;
    user.deletionRequestedAt = new Date();
    user.deletionReason = reason.trim();
    user.deletionStatus = 'pending';
    await user.save();

    // Create admin notification
    const notification = new AdminNotification({
      type: 'account_deletion',
      title: `Account Deletion Request - ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}`,
      message: `${user.name} (${user.email}) has requested to delete their ${user.role} account.`,
      fromUser: user._id,
      data: {
        reason: reason.trim(),
        userRole: user.role,
        userEmail: user.email,
        userName: user.name
      },
      status: 'unread'
    });
    await notification.save();

    console.log(`Account deletion requested by ${user.email} (${user.role})`);

    res.json({
      success: true,
      message: 'Account deletion request submitted successfully. Your account will be reviewed by admin.',
      deletionStatus: 'pending',
      requestedAt: user.deletionRequestedAt
    });

  } catch (error) {
    console.error('Request account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during account deletion request'
    });
  }
};

// Cancel account deletion request (by user)
const cancelDeletionRequest = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if there's a pending request
    if (!user.deletionRequested || user.deletionStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending deletion request found'
      });
    }

    // Cancel the request
    user.deletionRequested = false;
    user.deletionRequestedAt = null;
    user.deletionReason = null;
    user.deletionStatus = 'none';
    await user.save();

    // Update admin notification status
    await AdminNotification.updateMany(
      { fromUser: userId, type: 'account_deletion', status: 'unread' },
      { status: 'actioned', actionTaken: 'none', actionNote: 'Cancelled by user' }
    );

    console.log(`Account deletion request cancelled by ${user.email}`);

    res.json({
      success: true,
      message: 'Account deletion request cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel deletion request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get deletion request status (for user)
const getDeletionStatus = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const user = await User.findById(userId).select('deletionRequested deletionRequestedAt deletionReason deletionStatus isActive');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      deletionRequested: user.deletionRequested,
      deletionStatus: user.deletionStatus,
      deletionRequestedAt: user.deletionRequestedAt,
      deletionReason: user.deletionReason,
      isActive: user.isActive
    });

  } catch (error) {
    console.error('Get deletion status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// ============================================
// ADMIN FUNCTIONS FOR ACCOUNT MANAGEMENT
// ============================================

// Get all deletion requests (admin only)
const getDeletionRequests = async (req, res) => {
  try {
    const { status } = req.query; // 'pending', 'approved', 'rejected', 'all'

    let filter = { deletionRequested: true };
    if (status && status !== 'all') {
      filter.deletionStatus = status;
    }

    const requests = await User.find(filter)
      .select('name email role deletionRequestedAt deletionReason deletionStatus isActive createdAt')
      .sort({ deletionRequestedAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error('Get deletion requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Approve account deletion (admin only)
const approveAccountDeletion = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user?.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.deletionRequested || user.deletionStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending deletion request for this user'
      });
    }

    // Soft delete - deactivate account
    user.isActive = false;
    user.deletionStatus = 'approved';
    user.deletionApprovedBy = adminId;
    user.deletionApprovedAt = new Date();
    user.deactivatedAt = new Date();
    await user.save();

    // Update admin notification
    await AdminNotification.updateMany(
      { fromUser: userId, type: 'account_deletion', status: { $ne: 'actioned' } },
      { status: 'actioned', handledBy: adminId, handledAt: new Date(), actionTaken: 'approved' }
    );

    console.log(`Account deletion approved for ${user.email} by admin ${adminId}`);

    res.json({
      success: true,
      message: `Account for ${user.email} has been deactivated`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        deletionStatus: user.deletionStatus
      }
    });

  } catch (error) {
    console.error('Approve account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reject account deletion (admin only)
const rejectAccountDeletion = async (req, res) => {
  try {
    const { userId } = req.params;
    const { note } = req.body;
    const adminId = req.user?.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.deletionRequested || user.deletionStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending deletion request for this user'
      });
    }

    // Reject the request
    user.deletionStatus = 'rejected';
    user.deletionApprovedBy = adminId;
    user.deletionApprovedAt = new Date();
    await user.save();

    // Update admin notification
    await AdminNotification.updateMany(
      { fromUser: userId, type: 'account_deletion', status: { $ne: 'actioned' } },
      { status: 'actioned', handledBy: adminId, handledAt: new Date(), actionTaken: 'rejected', actionNote: note || 'Rejected by admin' }
    );

    console.log(`Account deletion rejected for ${user.email} by admin ${adminId}`);

    res.json({
      success: true,
      message: `Account deletion request rejected for ${user.email}`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        deletionStatus: user.deletionStatus
      }
    });

  } catch (error) {
    console.error('Reject account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reactivate account (admin only)
const reactivateAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user?.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account is already active'
      });
    }

    // Reactivate account
    user.isActive = true;
    user.deletionRequested = false;
    user.deletionRequestedAt = null;
    user.deletionReason = null;
    user.deletionStatus = 'none';
    user.deactivatedAt = null;
    await user.save();

    console.log(`Account reactivated for ${user.email} by admin ${adminId}`);

    res.json({
      success: true,
      message: `Account for ${user.email} has been reactivated`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      }
    });

  } catch (error) {
    console.error('Reactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get admin notifications (admin only)
const getAdminNotifications = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (type && type !== 'all') {
      filter.type = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await AdminNotification.find(filter)
      .populate('fromUser', 'name email role profilePic')
      .populate('handledBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AdminNotification.countDocuments(filter);
    const unreadCount = await AdminNotification.countDocuments({ status: 'unread' });

    res.json({
      success: true,
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalNotifications: total,
        unreadCount
      }
    });

  } catch (error) {
    console.error('Get admin notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Mark notification as read (admin only)
const markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await AdminNotification.findByIdAndUpdate(
      notificationId,
      { status: 'read' },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export default {
  register,
  verifyOTP,
  resendOTP,
  login,
  getProfile,
  getMyProfile,
  updateProfile,
  updateUserProfile,
  deleteUserProfile,
  getAllUsers,
  forgotPassword,
  verifyPasswordResetOTP,
  resetPassword,
  sendOtp,
  refreshToken,
  logout,
  uploadProfilePic,
  // Account deletion (soft delete)
  requestAccountDeletion,
  cancelDeletionRequest,
  getDeletionStatus,
  // Admin functions
  getDeletionRequests,
  approveAccountDeletion,
  rejectAccountDeletion,
  reactivateAccount,
  getAdminNotifications,
  markNotificationRead
};
