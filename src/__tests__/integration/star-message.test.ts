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
    visitorEmail: `star-visitor${index}@example.com`,
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

describe('Integration: Star Message (POST /api/chat/messages/:messageId/star)', () => {
  it('should star a message and return the updated message', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Alice', 1);
    const messageId = await createTestMessage(roomId, 'Hello world');

    const res = await request(app)
      .post(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.starredBy).toBeDefined();
    expect(res.body.starredBy).toHaveLength(1);
    expect(res.body.starredBy[0].userId).toBe(ADMIN_USER_ID);
    expect(res.body.starredBy[0].starredAt).toBeDefined();
  });

  it('should be idempotent - starring same message again returns 200', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Bob', 2);
    const messageId = await createTestMessage(roomId, 'Test message');

    // Star first time
    await request(app)
      .post(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    // Star second time
    const res = await request(app)
      .post(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Should still only have 1 star entry
    const msg = await Message.findById(messageId).lean();
    expect(msg!.starredBy).toHaveLength(1);
  });

  it('should return 404 when message does not exist', async () => {
    const token = generateAdminToken();
    const fakeMessageId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/chat/messages/${fakeMessageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 when no token is provided', async () => {
    const roomId = await createTestRoom('NoAuth', 100);
    const messageId = await createTestMessage(roomId, 'Unauthorized');

    const res = await request(app).post(`/api/chat/messages/${messageId}/star`);

    expect(res.status).toBe(401);
  });
});

describe('Integration: Unstar Message (DELETE /api/chat/messages/:messageId/star)', () => {
  it('should unstar a message successfully', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Charlie', 3);
    const messageId = await createTestMessage(roomId, 'Unstar me');

    // Star first
    await request(app)
      .post(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    // Unstar
    const res = await request(app)
      .delete(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Verify star was removed
    const msg = await Message.findById(messageId).lean();
    const hasStarEntry = msg!.starredBy?.some(
      (s) => s.userId === ADMIN_USER_ID
    );
    expect(hasStarEntry).toBeFalsy();
  });

  it('should return 404 when message does not exist', async () => {
    const token = generateAdminToken();
    const fakeMessageId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .delete(`/api/chat/messages/${fakeMessageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 when no token is provided', async () => {
    const roomId = await createTestRoom('NoAuth2', 101);
    const messageId = await createTestMessage(roomId, 'No auth unstar');

    const res = await request(app).delete(
      `/api/chat/messages/${messageId}/star`
    );

    expect(res.status).toBe(401);
  });
});

describe('Integration: Get Starred Messages (GET /api/chat/starred-messages)', () => {
  it('should return starred messages sorted by starredAt descending', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Diana', 4);

    // Create and star messages with different timestamps
    const msg1Id = await createTestMessage(roomId, 'First message');
    const msg2Id = await createTestMessage(roomId, 'Second message');
    const msg3Id = await createTestMessage(roomId, 'Third message');

    // Star in order: msg1, then msg2, then msg3
    await request(app)
      .post(`/api/chat/messages/${msg1Id}/star`)
      .set('Authorization', `Bearer ${token}`);

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));

    await request(app)
      .post(`/api/chat/messages/${msg2Id}/star`)
      .set('Authorization', `Bearer ${token}`);

    await new Promise((r) => setTimeout(r, 50));

    await request(app)
      .post(`/api/chat/messages/${msg3Id}/star`)
      .set('Authorization', `Bearer ${token}`);

    // Get starred messages
    const res = await request(app)
      .get('/api/chat/starred-messages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    // Most recently starred first
    expect(res.body[0]._id).toBe(msg3Id);
    expect(res.body[1]._id).toBe(msg2Id);
    expect(res.body[2]._id).toBe(msg1Id);
  });

  it('should exclude messages from deleted rooms', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Eve', 5);
    const messageId = await createTestMessage(roomId, 'Will be orphaned');

    // Star the message
    await request(app)
      .post(`/api/chat/messages/${messageId}/star`)
      .set('Authorization', `Bearer ${token}`);

    // Delete the room (message stays in DB but room is gone)
    await Room.findByIdAndDelete(roomId);

    // Get starred messages - should exclude orphaned messages
    const res = await request(app)
      .get('/api/chat/starred-messages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('should return 401 when no token is provided', async () => {
    const res = await request(app).get('/api/chat/starred-messages');

    expect(res.status).toBe(401);
  });
});
