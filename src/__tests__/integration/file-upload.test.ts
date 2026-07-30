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
import fs from 'fs';
import path from 'path';

import { registerRoutes } from '../../routes';
import { registerVisitorNamespace, registerAdminNamespace } from '../../socket';
import { setIo } from '../../socket/io';

const TEST_JWT_SECRET = 'test-secret-key';
const ADMIN_USER_ID = '507f1f77bcf86cd799439011';
const ADMIN_EMAIL = 'admin@example.com';

let mongoServer: MongoMemoryServer;
let app: express.Express;
let httpServer: http.Server;
let io: Server;

function generateAdminToken(): string {
  return jwt.sign(
    { id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: 'admin' },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Create a temporary test file
function createTempFile(
  filename: string,
  sizeBytes: number,
  content?: Buffer
): string {
  const tmpDir = path.resolve(__dirname, '../../../tmp-test-uploads');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(tmpDir, filename);
  if (content) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, Buffer.alloc(sizeBytes));
  }
  return filePath;
}

// Minimal valid JPEG buffer (smallest valid JPEG)
function createMinimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
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

  // Clean up temp files
  const tmpDir = path.resolve(__dirname, '../../../tmp-test-uploads');
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('Integration: File Upload (POST /api/chat/upload)', () => {
  it('should upload a valid JPEG file and return attachment metadata', async () => {
    const token = generateAdminToken();
    const jpegBuffer = createMinimalJpeg();
    const filePath = createTempFile('test-image.jpg', 0, jpegBuffer);

    const res = await request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', filePath);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].fileName).toBe('test-image.jpg');
    expect(res.body.attachments[0].mimeType).toBe('image/jpeg');
    expect(res.body.attachments[0].isImage).toBe(true);
    expect(res.body.attachments[0].url).toMatch(/^\/uploads\/chat\//);
    expect(res.body.attachments[0].fileSize).toBeGreaterThan(0);
  });

  it('should upload a valid PDF file and return attachment metadata', async () => {
    const token = generateAdminToken();
    // Minimal PDF
    const pdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
    const filePath = createTempFile('document.pdf', 0, pdfContent);

    const res = await request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', filePath);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].fileName).toBe('document.pdf');
    expect(res.body.attachments[0].mimeType).toBe('application/pdf');
    expect(res.body.attachments[0].isImage).toBe(false);
  });

  it('should upload multiple files at once', async () => {
    const token = generateAdminToken();
    const jpegBuffer = createMinimalJpeg();
    const file1 = createTempFile('img1.jpg', 0, jpegBuffer);
    const file2 = createTempFile('img2.jpg', 0, jpegBuffer);

    const res = await request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', file1)
      .attach('files', file2);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(2);
  });

  it('should return 400 when file exceeds 10MB', async () => {
    const token = generateAdminToken();
    // Create an 11MB file
    const largePath = createTempFile('large.jpg', 11 * 1024 * 1024);

    const res = await request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', largePath);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10MB|size/i);
  });

  it('should return 400 when file type is not allowed', async () => {
    const token = generateAdminToken();
    const filePath = createTempFile('script.exe', 100);

    const res = await request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', filePath);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type|supported/i);
  });

  it('should return 400 when more than 5 files are uploaded', async () => {
    const token = generateAdminToken();
    const jpegBuffer = createMinimalJpeg();
    const files = Array.from({ length: 6 }, (_, i) =>
      createTempFile(`img${i}.jpg`, 0, jpegBuffer)
    );

    let req = request(app)
      .post('/api/chat/upload')
      .set('Authorization', `Bearer ${token}`);

    for (const file of files) {
      req = req.attach('files', file);
    }

    const res = await req;

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/5|files|maximum/i);
  });

  it('should return 401 when no token is provided', async () => {
    const jpegBuffer = createMinimalJpeg();
    const filePath = createTempFile('no-auth.jpg', 0, jpegBuffer);

    const res = await request(app)
      .post('/api/chat/upload')
      .attach('files', filePath);

    expect(res.status).toBe(401);
  });
});
