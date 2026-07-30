import './config/env';

import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { Server } from 'socket.io';
import { env } from './config/env';
import { connectDB } from './config/db';
import { registerRoutes } from './routes';
import { registerSocketHandlers, registerVisitorNamespace, registerAdminNamespace } from './socket';
import { setIo } from './socket/io';

const app = express();
const server = http.createServer(app);

// Allowed origins for CORS (portfolio + admin frontends)
const allowedOrigins = [env.PORTFOLIO_URL, env.ADMIN_URL];

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

// Make io available to controllers via singleton
setIo(io);

// Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chat-service' });
});

// Register REST routes
registerRoutes(app);

// Register Socket.IO handlers (default namespace — backward compatibility)
registerSocketHandlers(io);

// Register Socket.IO namespaces for live chat
registerVisitorNamespace(io);
registerAdminNamespace(io);

// Start server
async function start(): Promise<void> {
  await connectDB();

  server.listen(env.PORT, () => {
    console.log(`Chat service running on port ${env.PORT}`);
  });
}

start();

export { app, server, io };
