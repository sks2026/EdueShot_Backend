import jwt from 'jsonwebtoken';

// Validate JWT_SECRET exists at startup
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required but not set');
  }
  return secret;
};

// JWT Authentication Middleware (required)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        expired: true
      });
    }
    return res.status(403).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Optional JWT Authentication Middleware (doesn't fail if no token)
const optionalAuthenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    // No token provided - continue without authentication
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    // Invalid or expired token - continue without authentication
    req.user = null;
    next();
  }
};

// Teacher-only middleware - checks if user has teacher role
const teacherOnly = (req, res, next) => {
  // First check if user is authenticated
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Check if user has teacher role
  if (req.user.role !== 'teacher') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only teachers can perform this action.'
    });
  }

  next();
};

// Admin-only middleware - checks if user has admin role
const adminOnly = (req, res, next) => {
  // First check if user is authenticated
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Check if user has admin role
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only administrators can perform this action.'
    });
  }

  next();
};

export { authenticateToken, optionalAuthenticateToken, teacherOnly, adminOnly, getJwtSecret };
export default authenticateToken;
