const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');

// Helper to check if R2 is configured
const isR2Configured = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  return (
    accountId && accountId !== 'YOUR_CLOUDFLARE_ACCOUNT_ID' &&
    accessKeyId && accessKeyId !== 'YOUR_R2_ACCESS_KEY_ID' &&
    secretKey && secretKey !== 'YOUR_R2_SECRET_ACCESS_KEY' &&
    bucketName && bucketName !== 'YOUR_R2_BUCKET_NAME'
  );
};

// Legacy Cloudflare R2 presigned URL route
router.post('/presign', async (req, res) => {
  const { fileName, fileType } = req.body;

  if (!fileName || !fileType) {
    return res.status(400).json({
      success: false,
      message: 'Both fileName and fileType are required.'
    });
  }

  // If R2 is not configured, return a custom error that triggers frontend fallback
  if (!isR2Configured()) {
    console.warn('[Image Server] Cloudflare R2 is not configured. Request will fall back to Firebase Storage.');
    return res.status(503).json({
      success: false,
      fallback: true,
      message: 'Cloudflare R2 is not configured on the server. Please set R2 credentials in server/.env'
    });
  }

  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    const key = `products/${Date.now()}_${fileName}`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    // Generate presigned PUT URL valid for 5 minutes (300 seconds)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Clean public domain format: ensure no trailing slash, and append key
    let publicDomain = process.env.R2_PUBLIC_DOMAIN || '';
    if (publicDomain.endsWith('/')) {
      publicDomain = publicDomain.slice(0, -1);
    }
    
    const publicUrl = `${publicDomain}/${key}`;

    res.json({
      success: true,
      uploadUrl,
      publicUrl,
      key
    });
  } catch (err) {
    console.error('[Image Server] Error generating presigned URL:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating presigned URL: ' + err.message
    });
  }
});

// Helper to gather all configured Supabase accounts dynamically from env variables
const getSupabaseProjects = () => {
  const projects = [];
  let i = 1;
  while (true) {
    const url = process.env[`SUPABASE_URL_${i}`];
    const key = process.env[`SUPABASE_KEY_${i}`];
    const bucket = process.env[`SUPABASE_BUCKET_${i}`] || 'products';
    
    if (!url || !key) break;
    
    // Ensure URL doesn't have trailing slash
    const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    projects.push({ url: cleanUrl, key, bucket });
    i++;
  }
  return projects;
};

const { publicOrderLimiter } = require('../middleware/rateLimiter');

// Supabase Storage upload endpoint with dynamic account failover
router.post('/upload', publicOrderLimiter, express.raw({ type: 'image/*', limit: '10mb' }), async (req, res) => {
  try {
    const fileBuffer = req.body;
    const fileType = req.headers['content-type'] || 'image/webp';
    const originalFileName = req.headers['x-file-name'] || 'product.webp';

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, message: 'No image data received.' });
    }

    const projects = getSupabaseProjects();
    if (projects.length === 0) {
      console.error('[Supabase Upload] No Supabase projects are configured in server/.env');
      return res.status(500).json({ 
        success: false, 
        message: 'Storage backend configuration error. No Supabase projects found.' 
      });
    }

    // Clean filename and extension
    const cleanName = originalFileName.split('.').slice(0, -1).join('.') || 'product';
    const fileExt = originalFileName.split('.').pop() || 'webp';
    const storageFileName = `${Date.now()}_${cleanName}.${fileExt}`;

    let publicUrl = null;
    let uploadSuccess = false;
    const errorsLog = [];

    // Attempt upload sequentially. If one fails, try the next one.
    for (let idx = 0; idx < projects.length; idx++) {
      const project = projects[idx];
      try {
        console.log(`[Supabase Upload] Attempting upload to Supabase Account ${idx + 1} (${project.url})...`);
        
        // Supabase Object Store Upload URL
        const uploadUrl = `${project.url}/storage/v1/object/${project.bucket}/${storageFileName}`;

        const response = await axios.post(uploadUrl, fileBuffer, {
          headers: {
            'Authorization': `Bearer ${project.key}`,
            'ApiKey': project.key,
            'Content-Type': fileType
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });

        if (response.status === 200 || response.status === 201) {
          // Construct public URL
          publicUrl = `${project.url}/storage/v1/object/public/${project.bucket}/${storageFileName}`;
          uploadSuccess = true;
          console.log(`[Supabase Upload] Success on Supabase Account ${idx + 1}! URL: ${publicUrl}`);
          break;
        }
      } catch (err) {
        const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
        console.warn(`[Supabase Upload] Account ${idx + 1} failed:`, errMsg);
        errorsLog.push(`Account ${idx + 1} (${project.url}): ${errMsg}`);
      }
    }

    if (uploadSuccess && publicUrl) {
      return res.json({ success: true, publicUrl });
    } else {
      return res.status(507).json({
        success: false,
        message: 'All Supabase storage accounts failed or exceeded limits.',
        errors: errorsLog
      });
    }
  } catch (error) {
    console.error('[Supabase Upload Root] Critical server exception:', error);
    return res.status(500).json({ success: false, message: 'Internal server upload error: ' + error.message });
  }
});

module.exports = router;
