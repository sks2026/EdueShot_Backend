import express from 'express';
import { authenticateToken } from '../Middleware/userAuth.js';
import { getSignedGetUrl } from '../services/s3Service.js';

const router = express.Router();

// GET /api/s3/signed-url?key=<s3Key>
// Returns signed URL for accessing private S3 objects
// Protected with JWT authentication
router.get('/signed-url', authenticateToken, async (req, res) => {
  try {
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'S3 key is required. Use ?key=<s3Key>'
      });
    }

    // Optional: custom expiry time in seconds (default: 604800 = 7 days for videos)
    // For course videos, use maximum expiry to avoid mid-watch expiration
    const expiresIn = parseInt(req.query.expiresIn) || 604800;

    const signedUrlData = await getSignedGetUrl(key, expiresIn);

    res.json({
      success: true,
      url: signedUrlData.url, // Signed URL
      key: key,
      expiresAt: signedUrlData.expiresAt, // Expiry timestamp
      expiresIn: signedUrlData.expiresIn // Expiry in seconds
    });
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate signed URL',
      message: error.message
    });
  }
});

export default router;

