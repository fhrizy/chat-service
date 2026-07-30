// Set environment variables BEFORE any imports
process.env.JWT_SECRET = 'test-secret-key';
process.env.PORT = '0';
process.env.DATABASE_URL = 'mongodb://localhost:27017/test';
process.env.PORTFOLIO_URL = 'http://localhost:5173';
process.env.ADMIN_URL = 'http://localhost:5174';

import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { registerRoutes } from '../../routes';
import { registerVisitorNamespace, registerAdminNamespace } from '../../socket';
import { setIo } from '../../socket/io';
import { Room } from '../../models/Room';
import { Message } from '../../models/Message';

const TEST_JWT_SECRET = 'test-secret-key';
const ADMIN_USER_ID = '507f1f77bcf86cd799439011';
const ADMIN_EMAIL = 'admin@example.com';

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: Server;

function generateAdminToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: 'admin', ...overrides },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function createTestRoom(name: string, index: number): Promise<string> {
  const room = await Room.create({
    active: true,
    name,
    type: 'visitor',
    members: [ADMIN_USER_ID],
    visitorName: name,
    visitorEmail: `del-visitor${index}@example.com`,
  });
  return room._id.toString();
}

async function createTestMessage(roomId: string, content: string): Promise<string> {
  const message = await Message.create({
    from: 'visitor123',
    roomId,
    content,
    senderType: 'visitor',
    senderName: 'Visitor',
  });
  return message._id.toString();
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  app = express();
  httpServer = http.createServer(app);
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  setIo(io);
  app.use(express.json());
  registerRoutes(app);
  registerVisitorNamespace(io);
  registerAdminNamespace(io);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });
});

afterAll(async () => {
  io.close();
  httpServer.close();
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Room.deleteMany({});
  await Message.deleteMany({});
});

describe('Integration: Delete Room (DELETE /api/chat/rooms/:roomId)', () => {
  it('should delete room and all associated messages', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Alice', 1);

    // Create some messages in the room
    await createTestMessage(roomId, 'Message 1');
    await createTestMessage(roomId, 'Message 2');
    await createTestMessage(roomId, 'Message 3');

    // Verify messages exist
    const messagesBefore = await Message.find({ roomId });
    expect(messagesBefore).toHaveLength(3);

    const res = await request(app)
      .delete(`/api/chat/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(roomId);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('should verify room no longer exists in DB after deletion', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Bob', 2);

    await request(app)
      .delete(`/api/chat/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token}`);

    const room = await Room.findById(roomId);
    expect(room).toBeNull();
  });

  it('should verify messages no longer exist in DB after deletion', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Charlie', 3);

    await createTestMessage(roomId, 'To be deleted 1');
    await createTestMessage(roomId, 'To be deleted 2');

    await request(app)
      .delete(`/api/chat/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token}`);

    const messages = await Message.find({ roomId });
    expect(messages).toHaveLength(0);
  });

  it('should return 404 when room does not exist', async () => {
    const token = generateAdminToken();
    const fakeRoomId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .delete(`/api/chat/rooms/${fakeRoomId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 when no token is provided', async () => {
    const roomId = await createTestRoom('NoAuth', 100);

    const res = await request(app).delete(`/api/chat/rooms/${roomId}`);

    expect(res.status).toBe(401);
  });

  it('should not affect messages in other rooms', async () => {
    const token = generateAdminToken();
    const roomToDelete = await createTestRoom('Delete Me', 4);
    const roomToKeep = await createTestRoom('Keep Me', 5);

    await createTestMessage(roomToDelete, 'Deleted room msg');
    await createTestMessage(roomToKeep, 'Kept room msg');

    await request(app)
      .delete(`/api/chat/rooms/${roomToDelete}`)
      .set('Authorization', `Bearer ${token}`);

    // Messages in other room should still exist
    const keptMessages = await Message.find({ roomId: roomToKeep });
    expect(keptMessages).toHaveLength(1);
    expect(keptMessages[0].content).toBe('Kept room msg');
  });
});
