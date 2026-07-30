import { Response } from 'express';
import { Message } from '../models/Message';
import { Room } from '../models/Room';
import { AuthRequest } from '../middlewares/auth';

/**
 * POST /api/chat/messages/:messageId/star
 * Star a message for the authenticated admin.
 * Idempotent: if already starred, returns 200 without modification.
 * Protected by authMiddleware + requireAdmin.
 */
export async function starMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const adminId = req.user!.id;

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ message: 'Message not found' });
      return;
    }

    // Check if already starred by this admin (idempotent)
    const alreadyStarred = message.starredBy?.some(
      (entry) => entry.userId === adminId
    );

    if (alreadyStarred) {
      res.status(200).json(message);
      return;
    }

    // Add star entry
    const updatedMessage = await Message.findByIdAndUpdate(
      messageId,
      {
        $push: {
          starredBy: { userId: adminId, starredAt: new Date() },
        },
      },
      { new: true }
    );

    res.status(200).json(updatedMessage);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * DELETE /api/chat/messages/:messageId/star
 * Unstar a message for the authenticated admin.
 * Protected by authMiddleware + requireAdmin.
 */
export async function unstarMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const adminId = req.user!.id;

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ message: 'Message not found' });
      return;
    }

    // Remove the admin's star entry using $pull
    await Message.findByIdAndUpdate(messageId, {
      $pull: {
        starredBy: { userId: adminId },
      },
    });

    res.status(200).json({ message: 'Message unstarred successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * GET /api/chat/starred-messages
 * Return all starred messages for the authenticated admin,
 * sorted by starredAt descending.
 * Excludes messages whose room no longer exists (deleted rooms).
 * Protected by authMiddleware + requireAdmin.
 */
export async function getStarredMessages(req: AuthRequest, res: Response): Promise<void> {
  try {
    const adminId = req.user!.id;

    // Find all messages starred by this admin
    const messages = await Message.find({
      'starredBy.userId': adminId,
    }).lean();

    // Get all unique roomIds from starred messages
    const roomIds = [...new Set(messages.map((m) => m.roomId))];

    // Find which rooms still exist (to exclude deleted messages)
    const existingRooms = await Room.find({
      _id: { $in: roomIds },
    }).lean();

    const existingRoomMap = new Map(
      existingRooms.map((room) => [room._id.toString(), room])
    );

    // Filter out messages whose rooms no longer exist
    const validMessages = messages.filter((m) =>
      existingRoomMap.has(m.roomId)
    );

    // Sort by admin's starredAt timestamp descending
    validMessages.sort((a, b) => {
      const aStarred = a.starredBy?.find((s) => s.userId === adminId);
      const bStarred = b.starredBy?.find((s) => s.userId === adminId);
      const aTime = aStarred ? new Date(aStarred.starredAt).getTime() : 0;
      const bTime = bStarred ? new Date(bStarred.starredAt).getTime() : 0;
      return bTime - aTime;
    });

    // Include room info for display
    const result = validMessages.map((m) => {
      const room = existingRoomMap.get(m.roomId);
      return {
        ...m,
        roomInfo: room
          ? {
              roomId: room._id.toString(),
              visitorName: room.visitorName || room.name,
            }
          : null,
      };
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}
