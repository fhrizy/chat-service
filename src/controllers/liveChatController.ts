import { Request, Response } from 'express';
import { Room } from '../models/Room';
import { Message } from '../models/Message';
import { validateVisitorName, validateEmail } from '../utils/validation';
import { AuthRequest } from '../middlewares/auth';

/**
 * POST /api/chat/start-session
 * Starts or resumes a visitor chat session.
 * Accepts { name, email }, validates inputs, find-or-creates a Room,
 * and returns the roomId with last 50 messages.
 * No authentication required.
 */
export async function startSession(req: Request, res: Response): Promise<void> {
  try {
    const { name, email } = req.body;

    // Validate name
    if (!name || typeof name !== 'string') {
      res.status(400).json({ message: 'Name is required' });
      return;
    }

    const nameValidation = validateVisitorName(name);
    if (!nameValidation.valid) {
      res.status(400).json({ message: nameValidation.error });
      return;
    }

    // Validate email
    if (!email || typeof email !== 'string') {
      res.status(400).json({ message: 'Email is required' });
      return;
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      res.status(400).json({ message: emailValidation.error });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    // Find-or-create Room with upsert behavior
    const room = await Room.findOneAndUpdate(
      { visitorEmail: normalizedEmail, type: 'visitor' },
      {
        visitorName: name.trim(),
        visitorEmail: normalizedEmail,
        type: 'visitor',
        active: true,
        members: [normalizedEmail, 'admin'],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Fetch last 50 messages sorted by createdAt ascending
    const messages = await Message.find({ roomId: room._id.toString() })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    res.status(200).json({ roomId: room._id.toString(), messages });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * GET /api/chat/rooms
 * Returns all active visitor rooms with last message preview.
 * Sorted by most recent message (updatedAt descending).
 * Protected by authMiddleware + requireAdmin (wired in routes).
 */
export async function getRooms(_req: Request, res: Response): Promise<void> {
  try {
    const rooms = await Room.find({ type: 'visitor', active: true }).sort({
      updatedAt: -1,
    });

    const result = await Promise.all(
      rooms.map(async (room) => {
        const lastMessageDoc = await Message.findOne({
          roomId: room._id.toString(),
        }).sort({ createdAt: -1 });

        let lastMessage = '';
        if (lastMessageDoc) {
          const content =
            typeof lastMessageDoc.content === 'string'
              ? lastMessageDoc.content
              : '';
          lastMessage =
            content.length > 50 ? content.substring(0, 50) : content;
        }

        return {
          roomId: room._id.toString(),
          visitorName: room.visitorName,
          visitorEmail: room.visitorEmail,
          lastMessage,
          updatedAt: room.updatedAt,
        };
      })
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * GET /api/chat/rooms/:roomId/messages
 * Returns all messages for a room sorted by createdAt ascending.
 * Protected with authMiddleware + admin role check (wired in routes).
 */
export async function getRoomMessages(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;

    // Verify the room exists
    const room = await Room.findById(roomId);
    if (!room) {
      res.status(404).json({ message: 'Room not found' });
      return;
    }

    // Fetch all messages for the room sorted by createdAt ascending
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });

    res.status(200).json({ messages });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * POST /api/chat/rooms/:roomId/read
 * Bulk update all messages in room: add admin userId to readBy where not already present.
 * Returns count of updated messages.
 * Protected with authMiddleware + requireAdmin (wired in routes).
 */
export async function markRoomAsRead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;
    const userId = req.user!.id;

    // Verify the room exists
    const room = await Room.findById(roomId);
    if (!room) {
      res.status(404).json({ message: 'Room not found' });
      return;
    }

    // Bulk update: add admin userId to readBy where not already present
    const result = await Message.updateMany(
      { roomId, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );

    res.status(200).json({ updatedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}
