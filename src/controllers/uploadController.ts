import { Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import imageSize from 'image-size';
import cloudinary from '../config/cloudinary';
import { AuthRequest } from '../middlewares/auth';
import { IAttachment } from '../models/Message';

// Allowed MIME types for chat file uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// Image MIME types (subset used to determine if we extract dimensions)
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Maximum files per request
const MAX_FILES = 5;

// Use memory storage — files stay in buffer, uploaded directly to Cloudinary
const storage = multer.memoryStorage();

// File filter to validate MIME types
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        'File type not supported. Accepted: JPEG, PNG, WebP, GIF, PDF, DOC, DOCX, XLS, XLSX'
      )
    );
  }
};

// Configure multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

// Export the multer middleware for use in route registration
export const uploadMiddleware = upload.array('files', MAX_FILES);

/**
 * Upload a single file buffer to Cloudinary.
 * Returns the secure URL and public ID.
 */
async function uploadToCloudinary(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<{ secure_url: string; public_id: string }> {
  const isImage = IMAGE_MIME_TYPES.includes(mimeType);
  const resourceType = isImage ? 'image' : 'raw';

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'chat',
        resource_type: resourceType,
        public_id: `${Date.now()}-${originalName.replace(/\.[^/.]+$/, '')}`,
        ...(isImage && { transformation: [{ quality: 'auto', fetch_format: 'auto' }] }),
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result as { secure_url: string; public_id: string });
      }
    );
    uploadStream.end(buffer);
  });
}

/**
 * POST /api/chat/upload
 * Upload up to 5 files (max 10MB each).
 * Returns array of attachment metadata with Cloudinary URLs.
 */
export async function uploadFiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ message: 'No files provided' });
      return;
    }

    const attachments: IAttachment[] = await Promise.all(
      files.map(async (file) => {
        const isImage = IMAGE_MIME_TYPES.includes(file.mimetype);
        let width: number | undefined;
        let height: number | undefined;

        if (isImage) {
          try {
            const dimensions = imageSize(file.buffer);
            width = dimensions.width;
            height = dimensions.height;
          } catch {
            // If image-size fails, leave dimensions undefined
          }
        }

        // Upload to Cloudinary
        const result = await uploadToCloudinary(file.buffer, file.originalname, file.mimetype);

        const attachment: IAttachment = {
          url: result.secure_url,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          isImage,
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
        };

        return attachment;
      })
    );

    res.status(200).json({ attachments });
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    res.status(500).json({ message: 'Failed to upload files' });
  }
}

/**
 * Multer error handling middleware.
 * Converts multer-specific errors into user-friendly 400 responses.
 */
export function handleMulterError(
  err: Error,
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res
        .status(400)
        .json({ message: 'File size exceeds maximum allowed limit of 10MB' });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ message: 'Maximum 5 files per message' });
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ message: 'Maximum 5 files per message' });
      return;
    }
    res.status(400).json({ message: err.message });
    return;
  }

  // Custom file filter error
  if (err.message && err.message.includes('File type not supported')) {
    res.status(400).json({ message: err.message });
    return;
  }

  next(err);
}
