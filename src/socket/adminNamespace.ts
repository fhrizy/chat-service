import { Server, Socket } from 'socket.io';
import { verifyToken, TokenPayload } from '../middlewares/auth';
import { Room, Message, IAttachment } from '../models';
import { validateMessageContent } from '../utils/validation';
import { getAdminProfile } from '../utils/adminProfile';

interface AdminSocket extends Socket {
  user?: TokenPayload;
  room?: string;
}

/**
 * Register the /admin namespace.
 * JWT auth via `authorize` event — admin must authenticate before other operations.
 */
export function registerAdminNamespace(io: Server): void {
  const adminNs = io.of('/admin');

  adminNs.on('connection', (socket: AdminSocket) => {
    console.log(`[admin] Connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[admin] Disconnected: ${socket.id}`);
    });

    // Authenticate admin socket with JWT
    socket.on('authorize', (data: { token: string }) => {
      try {
        const payload = verifyToken(data.token);
        socket.user = payload;
        // Join global admin room for broadcast notifications
        socket.join('admin-global');
        console.log(`[admin] Authorized: ${socket.id} (${payload.id})`);
        socket.emit('authorized', { userId: payload.id });
      } catch {
        socket.emit('error', { message: 'Authorization failed' });
      }
    });

    // Join a specific chat room
    socket.on('join-room', async (data: { roomId: string }) => {
      if (!socket.user) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      const { roomId } = data;

      try {
        // Validate room exists
        const room = await Room.findById(roomId);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Leave any previously joined room (except socket.id and admin-global)
        const currentRooms = Array.from(socket.rooms);
        for (const r of currentRooms) {
          if (r !== socket.id && r !== 'admin-global') {
            socket.leave(r);
          }
        }

        // Store roomId on socket and join the room
        socket.room = roomId;
        socket.join(roomId);
        console.log(`[admin] ${socket.user.id} joined room ${roomId}`);

        // Bulk-update readBy for all messages in this room
        const updateResult = await Message.updateMany(
          { roomId, readBy: { $nin: [socket.user.id] } },
          { $addToSet: { readBy: socket.user.id } }
        );

        // If messages were updated, get their IDs and emit read-status-updated
        if (updateResult.modifiedCount > 0) {
          const updatedMessages = await Message.find(
            { roomId, readBy: socket.user.id },
            { _id: 1 }
          ).lean();

          const messageIds = updatedMessages.map((m) => m._id.toString());

          // Emit read-status-updated to the room
          io.of('/admin').to(roomId).emit('read-status-updated', {
            messageIds,
            readBy: socket.user.id,
          });

          // Also emit to visitor namespace so visitor sees read receipts
          io.of('/visitor').to(roomId).emit('read-status-updated', {
            messageIds,
            readBy: socket.user.id,
          });
        }
      } catch (err) {
        console.error(`[admin] Error joining room ${roomId}:`, err);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Send a message from admin
    socket.on('send-message', async (data: { roomId: string; message: string; attachments?: IAttachment[] }) => {
      if (!socket.user) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      const { roomId, message, attachments } = data;

      // Validate message content (admin max 1000 chars)
      const validation = validateMessageContent(message, 1000);
      if (!validation.valid) {
        socket.emit('error', { message: validation.error });
        return;
      }

      try {
        // Get admin profile info from shared database
        const adminProfile = await getAdminProfile();

        // Check if any visitor sockets are currently in this room
        const visitorRoom = io.of('/visitor').adapter.rooms.get(roomId);
        const visitorSockets = visitorRoom ? Array.from(visitorRoom) : [];
        const visitorEmails: string[] = [];

        for (const socketId of visitorSockets) {
          const vSocket = io.of('/visitor').sockets.get(socketId) as any;
          if (vSocket?.visitorEmail) {
            visitorEmails.push(vSocket.visitorEmail);
          }
        }

        // Initialize readBy with admin + any visitor currently in the room
        const initialReadBy = [socket.user.id, ...visitorEmails];

        // Persist message with senderType: 'admin'
        const savedMessage = await Message.create({
          from: socket.user.id,
          roomId,
          content: message,
          senderType: 'admin',
          senderName: adminProfile.name,
          senderEmail: adminProfile.email || socket.user.email || socket.user.id,
          readBy: initialReadBy,
          ...(attachments && attachments.length > 0 && { attachments }),
        });

        // Broadcast receive-message to all sockets in the room (admin namespace)
        io.of('/admin').to(roomId).emit('receive-message', {
          message: savedMessage,
        });

        // Emit new-message to visitor namespace room
        io.of('/visitor').to(roomId).emit('new-message', {
          roomId,
          message: savedMessage,
        });

        // If visitor was in room, emit read-status-updated to admin
        if (visitorEmails.length > 0) {
          io.of('/admin').to(roomId).emit('read-status-updated', {
            messageIds: [savedMessage._id.toString()],
            readBy: visitorEmails[0],
          });
        }

        // Emit room-updated to admin-global (for all admins to refresh room list)
        adminNs.to('admin-global').emit('room-updated', { roomId });

        console.log(`[admin] Message from ${socket.user.id} in room ${roomId}`);
      } catch (err) {
        console.error(`[admin] Error sending message in room ${roomId}:`, err);
        socket.emit('message-error', { message: 'Failed to send message' });
      }
    });
  });
}
