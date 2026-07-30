import { Server, Socket } from 'socket.io';
import { User, Room, Message } from '../models';
import { verifyToken, TokenPayload } from '../middlewares/auth';

// Re-export namespace registration functions
export { registerVisitorNamespace } from './visitorNamespace';
export { registerAdminNamespace } from './adminNamespace';

interface ChatSocket extends Socket {
  user?: string;
  room?: string;
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: ChatSocket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });

    // Authorize socket connection with JWT
    socket.on('authorize', async (data: { token: string; userId: string }) => {
      try {
        verifyToken(data.token);
        socket.user = data.userId;
        console.log(`User authorized: ${socket.id} (${data.userId})`);
      } catch {
        socket.emit('error', { message: 'Authorization failed' });
      }
    });

    // Join a chat room
    socket.on('join-room', async (data: { roomId: string }) => {
      if (!socket.user) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      // Leave all previous rooms except the socket's own room
      const joinedRooms = Array.from(socket.rooms);
      for (const room of joinedRooms) {
        if (room !== socket.id) {
          socket.leave(room);
        }
      }

      const room = await Room.findById(data.roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      socket.room = data.roomId;
      socket.join(data.roomId);
      console.log(`User ${socket.user} joined room ${data.roomId}`);
    });

    // Send a message
    socket.on('send-message', async (data: { message: string; timeSend: string }) => {
      if (!socket.user || !socket.room) {
        socket.emit('error', { message: 'Not authorized or not in a room' });
        return;
      }

      try {
        const user = await User.findById(socket.user);
        if (!user) return;

        const room = await Room.findById(socket.room);
        if (!room) return;

        const message = await Message.create({
          from: socket.user,
          roomId: socket.room,
          content: {
            type: 'text',
            name: user.name,
            username: user.username,
            message: data.message,
            readBy: [socket.user],
            timeSend: data.timeSend,
            timeReceived: new Date(),
          },
        });

        // Emit to all users in the room
        io.to(socket.room).emit('receive-message', message);

        // Emit room update for sidebar refresh
        const targetId = room.members.find((m) => m !== socket.user);
        const target = targetId ? await User.findById(targetId) : null;

        io.emit('update-room', {
          id: room._id,
          active: room.active,
          name: target?.name || room.name,
          type: room.type,
          members: room.members,
          lastMessage: message.content,
        });
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data: { isTyping: boolean }) => {
      if (!socket.user || !socket.room) return;
      socket.to(socket.room).emit('user-typing', {
        userId: socket.user,
        isTyping: data.isTyping,
      });
    });
  });
}
