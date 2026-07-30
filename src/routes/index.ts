import { Express } from 'express';
import { authMiddleware, requireAdmin } from '../middlewares/auth';
import { signup, signin, auth } from '../controllers/authController';
import {
  findUser,
  addContact,
  getContacts,
  createRoom,
  getRooms,
  getMessages,
  deleteRoom,
  deleteMessage,
} from '../controllers/chatController';
import {
  startSession,
  getRooms as getLiveChatRooms,
  getRoomMessages,
  markRoomAsRead,
} from '../controllers/liveChatController';
import { deleteRoom as deleteRoomChat } from '../controllers/deleteRoomController';
import {
  uploadMiddleware,
  uploadFiles,
  handleMulterError,
} from '../controllers/uploadController';
import { pinRoom, unpinRoom } from '../controllers/pinController';
import {
  starMessage,
  unstarMessage,
  getStarredMessages,
} from '../controllers/starController';

export function registerRoutes(app: Express): void {
  // Auth routes
  app.post('/api/signup', signup);
  app.post('/api/signin', signin);
  app.get('/api/auth', auth);

  // Chat routes (protected)
  app.get('/api/find-user', authMiddleware, findUser);
  app.post('/api/add-contact', authMiddleware, addContact);
  app.get('/api/get-contacts', getContacts);
  app.post('/api/create-room', authMiddleware, createRoom);
  app.get('/api/get-rooms', getRooms);
  app.get('/api/get-messages', getMessages);
  app.post('/api/delete-room', authMiddleware, deleteRoom);
  app.post('/api/delete-message', authMiddleware, deleteMessage);

  // Live chat routes
  app.post('/api/chat/start-session', startSession);
  app.get('/api/chat/rooms', authMiddleware, requireAdmin, getLiveChatRooms);
  app.get('/api/chat/rooms/:roomId/messages', authMiddleware, requireAdmin, getRoomMessages);
  app.post('/api/chat/rooms/:roomId/read', authMiddleware, requireAdmin, markRoomAsRead);

  // Pin/Unpin room routes
  app.post('/api/chat/rooms/:roomId/pin', authMiddleware, requireAdmin, pinRoom);
  app.delete('/api/chat/rooms/:roomId/pin', authMiddleware, requireAdmin, unpinRoom);

  // Star/Unstar message routes (admin only)
  app.post('/api/chat/messages/:messageId/star', authMiddleware, requireAdmin, starMessage);
  app.delete('/api/chat/messages/:messageId/star', authMiddleware, requireAdmin, unstarMessage);
  app.get('/api/chat/starred-messages', authMiddleware, requireAdmin, getStarredMessages);

  // Room deletion route (admin only)
  app.delete('/api/chat/rooms/:roomId', authMiddleware, requireAdmin, deleteRoomChat);

  // File upload route (authenticated users - both admin and visitor sessions can upload)
  app.post('/api/chat/upload', authMiddleware, uploadMiddleware, handleMulterError, uploadFiles);
}
