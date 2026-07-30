import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Room, Message } from '../models';
import { AuthRequest } from '../middlewares/auth';
import { getIo } from '../socket/io';

// Upload directory for chat files
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/chat');

/**
 * DELETE /api/chat/rooms/:roomId
 * Delete a room and all associated messages and file uploads.
 *
 * Stages:
 * 1. Find room (404 if not found)
 * 2. Find messages with attachments and delete files from disk
 * 3. Delete all messages for this room
 * 4. Delete the room record
 * 5. Emit `room-deleted` to /admin and /visitor namespaces
 *
 * Error handling (Requirement 6.9):
 * - If message deletion succeeds but room deletion fails → 500 "Room deletion incomplete"
 * - If any step fails partially → return error, do NOT remove room from view
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

    // Stage 2: Find messages with attachments and delete files from disk
    let filesDeletionFailed = false;
    try {
      const messagesWithAttachments = await Message.find({
        roomId,
        attachments: { $exists: true, $ne: [] },
      });

      for (const message of messagesWithAttachments) {
        if (message.attachments) {
          for (const attachment of message.attachments) {
            try {
              // Extract filename from the URL (e.g., "/uploads/chat/filename.ext")
              const fileName = path.basename(attachment.url);
              const filePath = path.join(UPLOAD_DIR, fileName);
              await fs.promises.unlink(filePath);
            } catch (err: any) {
              // Don't fail if file already missing (ENOENT)
              if (err.code !== 'ENOENT') {
                filesDeletionFailed = true;
              }
            }
          }
        }
      }
    } catch (err) {
      // If finding messages fails, return error
      console.error('[deleteRoom] Error finding messages with attachments:', err);
      res.status(500).json({ message: 'Room deletion incomplete' });
      return;
    }

    // If file deletion had non-ENOENT failures, report partial failure
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
      // Messages were deleted but room deletion failed - partial failure
      if (messagesDeleted) {
        res.status(500).json({ message: 'Room deletion incomplete' });
        return;
      }
      res.status(500).json({ message: 'Room deletion incomplete' });
      return;
    }

    // Stage 5: Emit socket events
    // Notify admin namespace (global admin room)
    getIo().of('/admin').to('admin-global').emit('room-deleted', { roomId });

    // Notify visitor namespace (specific room)
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
