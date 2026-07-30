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
    visitorEmail: `visitor${index}@example.com`,
  });
  return room._id.toString();
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
});

describe('Integration: Pin Room (POST /api/chat/rooms/:roomId/pin)', () => {
  it('should pin a room and return roomId and pinnedAt', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Alice', 1);

    const res = await request(app)
      .post(`/api/chat/rooms/${roomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(roomId);
    expect(res.body.pinnedAt).toBeDefined();
  });

  it('should be idempotent - pinning same room again returns 200', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Bob', 2);

    // Pin first time
    await request(app)
      .post(`/api/chat/rooms/${roomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    // Pin second time
    const res = await request(app)
      .post(`/api/chat/rooms/${roomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(roomId);
    expect(res.body.pinnedAt).toBeDefined();
  });

  it('should return 409 when 5 rooms are already pinned', async () => {
    const token = generateAdminToken();

    // Pin 5 rooms
    for (let i = 0; i < 5; i++) {
      const roomId = await createTestRoom(`Room ${i}`, i + 10);
      await request(app)
        .post(`/api/chat/rooms/${roomId}/pin`)
        .set('Authorization', `Bearer ${token}`);
    }

    // Try to pin a 6th room
    const sixthRoomId = await createTestRoom('Room 6', 99);
    const res = await request(app)
      .post(`/api/chat/rooms/${sixthRoomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/5|maximum|pinned/i);
  });

  it('should return 404 when room does not exist', async () => {
    const token = generateAdminToken();
    const fakeRoomId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/chat/rooms/${fakeRoomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 when no token is provided', async () => {
    const roomId = await createTestRoom('NoAuth', 100);

    const res = await request(app).post(`/api/chat/rooms/${roomId}/pin`);

    expect(res.status).toBe(401);
  });
});

describe('Integration: Unpin Room (DELETE /api/chat/rooms/:roomId/pin)', () => {
  it('should unpin a room and return roomId', async () => {
    const token = generateAdminToken();
    const roomId = await createTestRoom('Charlie', 3);

    // Pin first
    await request(app)
      .post(`/api/chat/rooms/${roomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    // Unpin
    const res = await request(app)
      .delete(`/api/chat/rooms/${roomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roomId).toBe(roomId);
  });

  it('should return 404 when room does not exist', async () => {
    const token = generateAdminToken();
    const fakeRoomId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .delete(`/api/chat/rooms/${fakeRoomId}/pin`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 when no token is provided', async () => {
    const roomId = await createTestRoom('NoAuth2', 101);

    const res = await request(app).delete(`/api/chat/rooms/${roomId}/pin`);

    expect(res.status).toBe(401);
  });
});
