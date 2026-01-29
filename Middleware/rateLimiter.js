import rateLimit from 'express-rate-limit';

// General API rate limiter - increased limit for better user experience
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Increased limit to 500 requests per 15 minutes (was 100)
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for static file requests
        return req.path.startsWith('/uploads/') || req.path.startsWith('/public/');
    }
});

// Strict limiter for login attempts
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: {
        success: false,
        message: 'Too many login attempts. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful logins
});

// OTP rate limiter
export const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // 3 OTP requests per 10 minutes
    message: {
        success: false,
        message: 'Too many OTP requests. Please try again after 10 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Password reset rate limiter
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset requests per hour
    message: {
        success: false,
        message: 'Too many password reset attempts. Please try again after 1 hour.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Account creation rate limiter
export const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    message: {
        success: false,
        message: 'Too many registration attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
