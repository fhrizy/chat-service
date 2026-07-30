import { Response } from 'express';
import { User, Room, Message } from '../models';
import { AuthRequest, verifyToken } from '../middlewares/auth';

export const findUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username } = req.query;
    if (!username || username === req.user?.username) {
      res.status(400).json({ message: 'Invalid username' });
      return;
    }

    const user = await User.findOne({ username: username as string });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json({
      id: user._id,
      name: user.name,
      username: user.username,
      role: user.role,
    });
  } catch {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const addContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { targetId } = req.body;
    const userId = req.user!.id;

    const target = await User.findById(targetId);
    if (!target) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const alreadyExists = user.contacts.some((c) => c.username === target.username);
    if (alreadyExists) {
      res.status(409).json({ message: 'Contact already exists' });
      return;
    }

    user.contacts.push({
      id: target._id.toString(),
      name: target.name,
      username: target.username,
      role: target.role,
    });
    await user.save();

    res.status(200).json({ message: `Contact ${target.name} added successfully` });
  } catch {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      res.status(401).json({ message: 'Token required' });
      return;
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.status(200).json(user.contacts);
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const createRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, type, targetId } = req.body;
    const userId = req.user!.id;

    const roomName = type === 'group' ? name : '';
    const members = [userId, targetId].sort();

    // Check if private room already exists
    if (type === 'private') {
      const existing = await Room.findOne({ members, type: 'private' });
      if (existing) {
        res.status(200).json({ roomId: existing._id });
        return;
      }
    }

    const room = await Room.create({
      active: true,
      name: roomName,
      type,
      members,
    });

    res.status(201).json({ roomId: room._id });
  } catch {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      res.status(401).json({ message: 'Token required' });
      return;
    }

    const payload = verifyToken(token);
    const rooms = await Room.find({ members: payload.id });

    const result = await Promise.all(
      rooms.map(async (room) => {
        const lastMessage = await Message.findOne({ roomId: room._id.toString() })
          .sort({ createdAt: -1 })
          .lean();

        // For private rooms, get the other member's name
        let displayName = room.name;
        if (room.type === 'private') {
          const targetId = room.members.find((m) => m !== payload.id);
          if (targetId) {
            const target = await User.findById(targetId);
            displayName = target?.name || 'Unknown';
          }
        }

        return {
          id: room._id,
          active: room.active,
          name: displayName,
          type: room.type,
          members: room.members,
          lastMessage: lastMessage?.content || null,
        };
      })
    );

    res.status(200).json(result);
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      res.status(401).json({ message: 'Token required' });
      return;
    }

    verifyToken(token);
    const { roomId } = req.query;

    if (!roomId) {
      res.status(400).json({ message: 'roomId is required' });
      return;
    }

    const messages = await Message.find({ roomId: roomId as string })
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json(messages);
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const deleteRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomId } = req.body;

    await Message.deleteMany({ roomId });
    await Room.findByIdAndDelete(roomId);

    res.status(200).json({ message: 'Room deleted successfully' });
  } catch {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messageId } = req.body;

    if (Array.isArray(messageId)) {
      await Message.deleteMany({ _id: { $in: messageId } });
    } else {
      await Message.findByIdAndDelete(messageId);
    }

    res.status(200).json({ message: 'Message deleted successfully' });
  } catch {
    res.status(500).json({ message: 'Internal server error' });
  }
};
