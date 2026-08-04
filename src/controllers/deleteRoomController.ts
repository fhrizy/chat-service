import { Response } from 'express';
import { Room, Message } from '../models';
import { AuthRequest } from '../middlewares/auth';
import { getIo } from '../socket/io';
import cloudinary from '../config/cloudinary';

/**
 * Extract Cloudinary public_id from a Cloudinary URL.
 * E.g., "https://res.cloudinary.com/xxx/image/upload/v123/chat/filename.jpg"
 * → "chat/filename"
 */
function extractPublicId(url: string): string | null {
  try {
    // Match pattern: /upload/v{digits}/{folder}/{filename}
    const match = url.match(/\/upload\/v\d+\/(.+)\.\w+$/);
    if (match) return match[1];

    // Fallback: match /upload/{folder}/{filename}
    const match2 = url.match(/\/upload\/(.+)\.\w+$/);
    if (match2) return match2[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * DELETE /api/chat/rooms/:roomId
 * Delete a room and all associated messages and file uploads.
 *
 * Stages:
 * 1. Find room (404 if not found)
 * 2. Find messages with attachments and delete files from Cloudinary
 * 3. Delete all messages for this room
 * 4. Delete the room record
 * 5. Emit `room-deleted` to /admin and /visitor namespaces
 */
export async function deleteRoom(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;

    // Stage 1: Find room
    const room = await Room.findById(roomId);
    if (!room) {
      res.status(404).json({ message: 'Room not found' });
      return;
    }

    // Stage 2: Find messages with attachments and delete files from Cloudinary
    let filesDeletionFailed = false;
    try {
      const messagesWithAttachments = await Message.find({
        roomId,
        attachments: { $exists: true, $ne: [] },
      });

      const publicIds: string[] = [];
      const rawPublicIds: string[] = [];

      for (const message of messagesWithAttachments) {
        if (message.attachments) {
          for (const attachment of message.attachments) {
            const publicId = extractPublicId(attachment.url);
            if (publicId) {
              if (attachment.isImage) {
                publicIds.push(publicId);
              } else {
                rawPublicIds.push(publicId);
              }
            }
          }
        }
      }

      // Delete images from Cloudinary (batch delete, max 100 per call)
      if (publicIds.length > 0) {
        for (let i = 0; i < publicIds.length; i += 100) {
          const batch = publicIds.slice(i, i + 100);
          await cloudinary.api.delete_resources(batch, { resource_type: 'image' });
        }
      }

      // Delete raw files (PDFs, docs, etc.)
      if (rawPublicIds.length > 0) {
        for (let i = 0; i < rawPublicIds.length; i += 100) {
          const batch = rawPublicIds.slice(i, i + 100);
          await cloudinary.api.delete_resources(batch, { resource_type: 'raw' });
        }
      }
    } catch (err) {
      console.error('[deleteRoom] Error deleting Cloudinary assets:', err);
      filesDeletionFailed = true;
    }

    // If file deletion failed, report partial failure
    if (filesDeletionFailed) {
      res.status(500).json({ message: 'Room deletion incomplete' });
      return;
    }

    // Stage 3: Delete all messages for this room
    let messagesDeleted = false;
    try {
      await Message.deleteMany({ roomId });
      messagesDeleted = true;
    } catch (err) {
      console.error('[deleteRoom] Error deleting messages:', err);
      res.status(500).json({ message: 'Room deletion incomplete' });
      return;
    }

    // Stage 4: Delete the room record
    try {
      await Room.findByIdAndDelete(roomId);
    } catch (err) {
      console.error('[deleteRoom] Error deleting room record:', err);
      if (messagesDeleted) {
        res.status(500).json({ message: 'Room deletion incomplete' });
        return;
      }
      res.status(500).json({ message: 'Room deletion incomplete' });
      return;
    }

    // Stage 5: Emit socket events
    getIo().of('/admin').to('admin-global').emit('room-deleted', { roomId });
    getIo().of('/visitor').to(roomId).emit('room-deleted', {
      roomId,
      message: 'This conversation has been ended by the admin.',
    });

    res.status(200).json({ message: 'Room deleted successfully', roomId });
  } catch (error) {
    console.error('[deleteRoom] Unexpected error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
