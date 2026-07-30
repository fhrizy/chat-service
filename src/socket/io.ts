import { Server } from 'socket.io';

/**
 * Singleton holder for the Socket.IO server instance.
 * This avoids circular dependency issues when controllers need to emit events.
 * Set once during app startup in index.ts, then imported by controllers.
 */
let ioInstance: Server | null = null;

export function setIo(io: Server): void {
  ioInstance = io;
}

export function getIo(): Server {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not initialized. Call setIo() first.');
  }
  return ioInstance;
}
