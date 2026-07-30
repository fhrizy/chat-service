import { Server, Socket } from 'socket.io';
import { Room } from '../models';
import { Message, IAttachment } from '../models';
import { validateMessageContent } from '../utils/validation';

interface VisitorSocket extends Socket {
  visitorEmail?: string;
  room?: string;
}

interface AdminSocketRef {
  user?: { id: string };
}

/**
 * Register the /visitor namespace.
 * No authentication required — visitors join by roomId + email.
 */
export function registerVisitorNamespace(io: Server): void {
  const visitorNs = io.of('/visitor');

  visitorNs.on('connection', (socket: VisitorSocket) => {
    console.log(`[visitor] Connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[visitor] Disconnected: ${socket.id}`);
    });

    // Join a visitor chat room
    socket.on('join-room', async (data: { roomId: string; email: string }) => {
      try {
        const { roomId, email } = data;

        // Find the room
        const room = await Room.findById(roomId);

        // Validate room exists and is a visitor room
        if (!room || room.type !== 'visitor') {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Validate email matches room's visitorEmail
        if (email.toLowerCase() !== room.visitorEmail) {
          socket.emit('error', { message: 'Email does not match room' });
          return;
        }

        // Store email and roomId on socket
        socket.visitorEmail = email;
        socket.room = roomId;

        // Join the socket to the room
        socket.join(roomId);
        console.log(`[visitor] ${email} joined room ${roomId}`);

        // Mark all messages in the room as read by this visitor
        const result = await Message.updateMany(
          { roomId, readBy: { $nin: [email] } },
          { $addToSet: { readBy: email } }
        );

        // Emit read-status-updated to the room if any messages were updated
        if (result.modifiedCount > 0) {
          const updatedMessages = await Message.find({
            roomId,
            readBy: email,
          }).select('_id');

          const messageIds = updatedMessages.map((msg) => msg._id.toString());

          io.of('/visitor').to(roomId).emit('read-status-updated', {
            messageIds,
            readBy: email,
          });
        }
      } catch (err) {
        console.error('[visitor] join-room error:', err);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Send a message from visitor
    socket.on(
      'send-message',
      async (data: { roomId: string; message: string; senderName: string; senderEmail: string; attachments?: IAttachment[] }) => {
        const { roomId, message, senderName, senderEmail, attachments } = data;

        // Validate message content (1–2000 chars)
        const validation = validateMessageContent(message, 2000);
        if (!validation.valid) {
          socket.emit('error', { message: validation.error });
          return;
        }

        try {
          // Check if any admin sockets are currently in this room
          const adminRoom = io.of('/admin').adapter.rooms.get(roomId);
          const adminSockets = adminRoom ? Array.from(adminRoom) : [];
          const adminUserIds: string[] = [];

          for (const socketId of adminSockets) {
            const adminSocket = io.of('/admin').sockets.get(socketId) as AdminSocketRef | undefined;
            if (adminSocket && (adminSocket as any).user?.id) {
              adminUserIds.push((adminSocket as any).user.id);
            }
          }

          // Initialize readBy with sender + any admin currently in the room
          const initialReadBy = [senderEmail, ...adminUserIds];

          // Persist the message
          const savedMessage = await Message.create({
            from: senderEmail,
            roomId,
            content: message,
            senderType: 'visitor',
            senderName,
            senderEmail,
            readBy: initialReadBy,
            ...(attachments && attachments.length > 0 && { attachments }),
          });

          // Broadcast receive-message to the room (all sockets in room including sender)
          io.of('/visitor').to(roomId).emit('receive-message', { message: savedMessage });

          // Emit new-message to admin namespace (global admin room)
          io.of('/admin').to('admin-global').emit('new-message', {
            roomId,
            message: savedMessage,
          });

          // If admin was in room, emit read-status-updated to visitor
          if (adminUserIds.length > 0) {
            io.of('/visitor').to(roomId).emit('read-status-updated', {
              messageIds: [savedMessage._id.toString()],
              readBy: adminUserIds[0],
            });
          }
        } catch (err) {
          console.error('[visitor] send-message error:', err);
          // On DB failure, emit message-error to the sender socket
          socket.emit('message-error', { message: 'Failed to send message' });
        }
      }
    );
  });
}
