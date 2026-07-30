// Set environment variables BEFORE any imports that use them
process.env.JWT_SECRET = 'test-secret-key';
process.env.PORT = '0';
process.env.DATABASE_URL = 'mongodb://localhost:27017/test';
process.env.PORTFOLIO_URL = 'http://localhost:5173';
process.env.ADMIN_URL = 'http://localhost:5174';

import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { registerRoutes } from '../../routes';
import { registerVisitorNamespace, registerAdminNamespace } from '../../socket';
import { Room } from '../../models/Room';
import { Message } from '../../models/Message';

const TEST_JWT_SECRET = 'test-secret-key';
const ADMIN_USER_ID = '507f1f77bcf86cd799439011';
const ADMIN_EMAIL = 'admin@example.com';

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: Server;
let serverPort: number;

function getBaseUrl(): string {
  return `http://localhost:${serverPort}`;
}

function generateAdminToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: 'admin', ...overrides },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function waitForEvent(socket: ClientSocket, event: string, timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for event: ${event}`)), timeout);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll(async () => {
  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Create Express + Socket.IO server
  app = express();
  httpServer = http.createServer(app);
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(express.json());
  registerRoutes(app);
  registerVisitorNamespace(io);
  registerAdminNamespace(io);

  // Start listening on random port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address();
      serverPort = typeof address === 'object' && address ? address.port : 0;
      resolve();
    });
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


describe('Integration: End-to-end chat flow', () => {
  it('visitor starts session → sends message → admin receives → admin replies → visitor receives', async () => {
    // 1. Visitor starts a session via REST
    const sessionRes = await request(app)
      .post('/api/chat/start-session')
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.roomId).toBeDefined();
    const { roomId } = sessionRes.body;

    // 2. Visitor connects to /visitor namespace and joins room
    const visitorSocket = ioClient(`${getBaseUrl()}/visitor`, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => visitorSocket.on('connect', resolve));

    visitorSocket.emit('join-room', { roomId, email: 'alice@example.com' });
    // Small delay to let the server process the join
    await new Promise((r) => setTimeout(r, 200));

    // 3. Admin connects to /admin namespace and authenticates
    const adminToken = generateAdminToken();
    const adminSocket = ioClient(`${getBaseUrl()}/admin`, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => adminSocket.on('connect', resolve));

    const authorizedPromise = waitForEvent(adminSocket, 'authorized');
    adminSocket.emit('authorize', { token: adminToken });
    await authorizedPromise;

    // Admin joins the room
    adminSocket.emit('join-room', { roomId });
    await new Promise((r) => setTimeout(r, 200));

    // 4. Visitor sends a message — admin receives via 'new-message' on admin-global
    const adminReceivePromise = waitForEvent(adminSocket, 'new-message');
    visitorSocket.emit('send-message', {
      roomId,
      message: 'Hello from visitor!',
      senderName: 'Alice',
      senderEmail: 'alice@example.com',
    });

    const adminReceived = (await adminReceivePromise) as { roomId: string; message: { content: string; senderType: string } };
    expect(adminReceived.message.content).toBe('Hello from visitor!');
    expect(adminReceived.message.senderType).toBe('visitor');
    expect(adminReceived.roomId).toBe(roomId);

    // 5. Admin replies — visitor receives via 'new-message' on visitor namespace room
    const visitorReceivePromise = waitForEvent(visitorSocket, 'new-message');
    adminSocket.emit('send-message', { roomId, message: 'Hi Alice, welcome!' });

    const visitorReceived = (await visitorReceivePromise) as { roomId: string; message: { content: string; senderType: string } };
    expect(visitorReceived.message.content).toBe('Hi Alice, welcome!');
    expect(visitorReceived.message.senderType).toBe('admin');
    expect(visitorReceived.roomId).toBe(roomId);

    // 6. Verify messages are persisted in DB
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello from visitor!');
    expect(messages[1].content).toBe('Hi Alice, welcome!');

    // Cleanup sockets
    visitorSocket.disconnect();
    adminSocket.disconnect();
  });
});

describe('Integration: Shared JWT authentication', () => {
  it('admin-service JWT token works on chat-service admin endpoints', async () => {
    const adminToken = generateAdminToken();

    // Create a room first
    const sessionRes = await request(app)
      .post('/api/chat/start-session')
      .send({ name: 'Bob', email: 'bob@test.com' });

    expect(sessionRes.status).toBe(200);
    const { roomId } = sessionRes.body;

    // GET /api/chat/rooms with admin token
    const roomsRes = await request(app)
      .get('/api/chat/rooms')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(roomsRes.status).toBe(200);
    expect(roomsRes.body).toHaveLength(1);
    expect(roomsRes.body[0].visitorName).toBe('Bob');
    expect(roomsRes.body[0].visitorEmail).toBe('bob@test.com');

    // GET /api/chat/rooms/:roomId/messages with admin token
    const messagesRes = await request(app)
      .get(`/api/chat/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.messages).toBeDefined();

    // POST /api/chat/rooms/:roomId/read with admin token
    const readRes = await request(app)
      .post(`/api/chat/rooms/${roomId}/read`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(readRes.status).toBe(200);
    expect(readRes.body.updatedCount).toBeDefined();
  });

  it('rejects requests without token', async () => {
    const roomsRes = await request(app).get('/api/chat/rooms');
    expect(roomsRes.status).toBe(401);
  });

  it('rejects requests with non-admin role token', async () => {
    const nonAdminToken = jwt.sign(
      { id: 'user123', email: 'user@test.com', role: 'user' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const roomsRes = await request(app)
      .get('/api/chat/rooms')
      .set('Authorization', `Bearer ${nonAdminToken}`);

    expect(roomsRes.status).toBe(401);
  });

  it('rejects requests with invalid/expired token', async () => {
    const expiredToken = jwt.sign(
      { id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: 'admin' },
      TEST_JWT_SECRET,
      { expiresIn: '-1h' } // already expired
    );

    const roomsRes = await request(app)
      .get('/api/chat/rooms')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(roomsRes.status).toBe(401);
    expect(roomsRes.body.message).toBeDefined();
  });

  it('rejects token signed with different secret', async () => {
    const wrongSecretToken = jwt.sign(
      { id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: 'admin' },
      'wrong-secret',
      { expiresIn: '1h' }
    );

    const roomsRes = await request(app)
      .get('/api/chat/rooms')
      .set('Authorization', `Bearer ${wrongSecretToken}`);

    expect(roomsRes.status).toBe(401);
  });
});

describe('Integration: Read status via socket', () => {
  it('admin joins room → readBy updated → event emitted to visitor', async () => {
    // 1. Visitor creates a session
    const sessionRes = await request(app)
      .post('/api/chat/start-session')
      .send({ name: 'Charlie', email: 'charlie@example.com' });

    const { roomId } = sessionRes.body;

    // 2. Visitor connects and sends messages
    const visitorSocket = ioClient(`${getBaseUrl()}/visitor`, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve) => visitorSocket.on('connect', resolve));

    visitorSocket.emit('join-room', { roomId, email: 'charlie@example.com' });
    await new Promise((r) => setTimeout(r, 200));

    // Send 3 messages from visitor
    for (let i = 0; i < 3; i++) {
      visitorSocket.emit('send-message', {
        roomId,
        message: `Message ${i + 1}`,
        senderName: 'Charlie',
        senderEmail: 'charlie@example.com',
      });
      await new Promise((r) => setTimeout(r, 100));
    }

    // Wait for messages to be persisted
    await new Promise((r) => setTimeout(r, 300));

    // Verify messages exist with visitor in readBy, but not admin
    const messagesBeforeJoin = await Message.find({ roomId }).lean();
    expect(messagesBeforeJoin.length).toBe(3);
    for (const msg of messagesBeforeJoin) {
      expect(msg.readBy).toContain('charlie@example.com');
      expect(msg.readBy).not.toContain(ADMIN_USER_ID);
    }

    // 3. Admin connects and authenticates
    const adminToken = generateAdminToken();
    const adminSocket = ioClient(`${getBaseUrl()}/admin`, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve) => adminSocket.on('connect', resolve));

    const authorizedPromise = waitForEvent(adminSocket, 'authorized');
    adminSocket.emit('authorize', { token: adminToken });
    await authorizedPromise;

    // 4. Set up listener for read-status-updated on visitor socket BEFORE admin joins
    const readStatusPromise = waitForEvent(visitorSocket, 'read-status-updated');

    // 5. Admin joins the room — this should trigger readBy update + event
    adminSocket.emit('join-room', { roomId });

    // 6. Visitor should receive read-status-updated event
    const readStatus = (await readStatusPromise) as { messageIds: string[]; readBy: string };
    expect(readStatus.messageIds).toBeDefined();
    expect(readStatus.messageIds.length).toBe(3);
    expect(readStatus.readBy).toBe(ADMIN_USER_ID);

    // 7. Verify database: all messages now have admin in readBy
    const messagesAfterJoin = await Message.find({ roomId }).lean();
    for (const msg of messagesAfterJoin) {
      expect(msg.readBy).toContain(ADMIN_USER_ID);
    }

    // Cleanup
    visitorSocket.disconnect();
    adminSocket.disconnect();
  });
});
