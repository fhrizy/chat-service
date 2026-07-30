import { Response } from 'express';
import { Room } from '../models';
import { AuthRequest } from '../middlewares/auth';
import { getIo } from '../socket/io';

const MAX_PINNED_ROOMS = 5;

/**
 * POST /api/chat/rooms/:roomId/pin
 * Pin a room for the authenticated admin.
 * Idempotent: returns 200 if already pinned.
 * Enforces max 5 pinned rooms per admin (returns 409 if exceeded).
 * Emits `room-pinned` event to admin-global room on /admin namespace.
 */
export async function pinRoom(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;
    const adminId = req.user!.id;

    // Check room exists
    const room = await Room.findById(roomId);
    if (!room) {
      res.status(404).json({ message: 'Room not found' });
      return;
    }

    // Check if already pinned by this admin (idempotent)
    const alreadyPinned = room.pinnedBy?.some((pin) => pin.userId === adminId);
    if (alreadyPinned) {
      const existingPin = room.pinnedBy!.find((pin) => pin.userId === adminId)!;
      res.status(200).json({ roomId, pinnedAt: existingPin.pinnedAt });
      return;
    }

    // Count how many rooms this admin has pinned
    const pinnedCount = await Room.countDocuments({
      'pinnedBy.userId': adminId,
    });

    if (pinnedCount >= MAX_PINNED_ROOMS) {
      res.status(409).json({ message: 'Maximum of 5 pinned rooms reached' });
      return;
    }

    // Add pin entry
    const pinnedAt = new Date();
    await Room.findByIdAndUpdate(roomId, {
      $push: { pinnedBy: { userId: adminId, pinnedAt } },
    });

    // Emit socket event to admin namespace
    getIo().of('/admin').to('admin-global').emit('room-pinned', { roomId, pinnedAt });

    res.status(200).json({ roomId, pinnedAt });
  } catch (error) {
    console.error('[pinRoom] Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * DELETE /api/chat/rooms/:roomId/pin
 * Unpin a room for the authenticated admin.
 * Removes admin's entry from pinnedBy array.
 * Emits `room-unpinned` event to admin-global room on /admin namespace.
 */
export async function unpinRoom(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;
    const adminId = req.user!.id;

    // Check room exists
    const room = await Room.findById(roomId);
    if (!room) {
      res.status(404).json({ message: 'Room not found' });
      return;
    }

    // Remove admin's pin entry using $pull
    await Room.findByIdAndUpdate(roomId, {
      $pull: { pinnedBy: { userId: adminId } },
    });

    // Emit socket event to admin namespace
    getIo().of('/admin').to('admin-global').emit('room-unpinned', { roomId });

    res.status(200).json({ roomId });
  } catch (error) {
    console.error('[unpinRoom] Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
