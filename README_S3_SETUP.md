# S3 Bucket Setup Guide

## Environment Variables Required

Add these to your `.env` file:

```env
# Enable/Disable S3 (choose ONE of the following methods)
# Method 1: Use S3_ENABLED flag
S3_ENABLED=true

# Method 2: Use STORAGE_TYPE (alternative method)
# STORAGE_TYPE=s3

# AWS S3 Configuration (required when S3 is enabled)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_S3_BUCKET_NAME=your_s3_bucket_name

# Optional: CloudFront CDN URL (for faster file delivery)
AWS_CLOUDFRONT_URL=https://your-cloudfront-domain.cloudfront.net
```

## How to Enable S3

You can enable S3 using **either** method:

**Method 1: Using S3_ENABLED flag**
```env
S3_ENABLED=true
```

**Method 2: Using STORAGE_TYPE**
```env
STORAGE_TYPE=s3
```

2. **Add AWS credentials:**
   ```env
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_key
   AWS_SECRET_ACCESS_KEY=your_secret
   AWS_S3_BUCKET_NAME=your_bucket
   ```

3. **Restart server** - You'll see:
   ```
   ✅ S3 enabled - Files will be uploaded to AWS S3
   ✅ S3 enabled, using memoryStorage for uploads
   📤 Files will be uploaded to AWS S3
   ```

## How to Disable S3 (Use Local Storage)

1. **Set S3_ENABLED flag:**
   ```env
   S3_ENABLED=false
   ```
   Or simply remove/comment out the S3_ENABLED line.

2. **Restart server** - You'll see:
   ```
   ℹ️ S3 disabled - Files will be saved to local storage
   ℹ️ S3 disabled, using local storage
   📁 Files will be saved to: C:\...\uploads
   ```

## Setup Instructions

1. **Create S3 Bucket:**
   - Go to AWS Console → S3
   - Create a new bucket
   - Set bucket name in `AWS_S3_BUCKET_NAME`
   - Set region in `AWS_REGION`

2. **Configure Bucket Permissions:**
   - Go to Bucket → Permissions
   - Edit "Block public access" settings
   - Uncheck "Block all public access" (or configure CORS as needed)
   - Add bucket policy for public read access:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
       }
     ]
   }
   ```

3. **Create IAM User and Set Permissions:**
   - Go to AWS Console → IAM → Users
   - Find your user: `eduspark-s3-user` (or create new one)
   - Click on the user → Go to "Permissions" tab
   - Click "Add permissions" → "Attach policies directly"
   - Search and attach: `AmazonS3FullAccess` (recommended for testing)
   
   **OR create a custom policy (more secure):**
   - Go to IAM → Policies → Create policy
   - Use JSON editor and paste this policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ],
         "Resource": "arn:aws:s3:::eduspark-assets-123/*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "s3:ListBucket"
         ],
         "Resource": "arn:aws:s3:::eduspark-assets-123"
       }
     ]
   }
   ```
   - Name it: `EdusparkS3Access`
   - Attach this policy to your IAM user
   - Save Access Key ID and Secret Access Key
   - Add to `.env` file

4. **Optional - CloudFront Setup:**
   - Create CloudFront distribution for your S3 bucket
   - Set `AWS_CLOUDFRONT_URL` in `.env` for faster CDN delivery

## How It Works

- **If S3 is configured:** Files are uploaded directly to S3, URLs are generated from S3/CloudFront
- **If S3 is NOT configured:** Falls back to local file storage (existing behavior)

## Files Modified

- `services/s3Service.js` - S3 upload/download utilities
- `Middleware/s3Upload.js` - Multer middleware with S3 integration
- `controllers/videoController.js` - Updated to use S3 URLs
- All route files updated to use new S3 upload middleware

## Testing

1. Set up `.env` with S3 credentials
2. Restart backend server
3. Upload a file - check console logs for S3 upload confirmation
4. Verify file is accessible via S3 URL

