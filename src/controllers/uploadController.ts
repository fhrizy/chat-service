import { Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import imageSize from 'image-size';
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

// Upload directory
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/chat');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

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
 * POST /api/chat/upload
 * Upload up to 5 files (max 10MB each).
 * Returns array of attachment metadata.
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
            const buffer = fs.readFileSync(file.path);
            const dimensions = imageSize(buffer);
            width = dimensions.width;
            height = dimensions.height;
          } catch {
            // If image-size fails, leave dimensions undefined
          }
        }

        const attachment: IAttachment = {
          url: `/uploads/chat/${file.filename}`,
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
    res.status(500).json({ message: 'Internal server error' });
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
