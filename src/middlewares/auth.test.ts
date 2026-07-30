import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken, authMiddleware, requireAdmin, AuthRequest, TokenPayload } from './auth';

// Use same secret as env config for testing
const TEST_SECRET = 'test-jwt-secret';

// Mock the env module
jest.mock('../config/env', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
  },
}));

function createMockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createMockRequest(authHeader?: string): AuthRequest {
  return {
    headers: {
      authorization: authHeader,
    },
  } as unknown as AuthRequest;
}

describe('verifyToken', () => {
  it('should return payload for valid token with id and role', () => {
    const payload = { id: 'user123', role: 'admin', email: 'admin@test.com' };
    const token = jwt.sign(payload, TEST_SECRET);
    const result = verifyToken(token);
    expect(result.id).toBe('user123');
    expect(result.role).toBe('admin');
  });

  it('should return payload for token with id, username, and role', () => {
    const payload = { id: 'user123', username: 'testuser', role: 'user' };
    const token = jwt.sign(payload, TEST_SECRET);
    const result = verifyToken(token);
    expect(result.id).toBe('user123');
    expect(result.username).toBe('testuser');
    expect(result.role).toBe('user');
  });

  it('should throw for token missing id claim', () => {
    const payload = { role: 'admin', email: 'admin@test.com' };
    const token = jwt.sign(payload, TEST_SECRET);
    expect(() => verifyToken(token)).toThrow('missing required claims');
  });

  it('should throw for token missing role claim', () => {
    const payload = { id: 'user123', email: 'admin@test.com' };
    const token = jwt.sign(payload, TEST_SECRET);
    expect(() => verifyToken(token)).toThrow('missing required claims');
  });

  it('should throw for expired token', () => {
    const payload = { id: 'user123', role: 'admin' };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '-1s' });
    expect(() => verifyToken(token)).toThrow();
  });

  it('should throw for token with invalid signature', () => {
    const payload = { id: 'user123', role: 'admin' };
    const token = jwt.sign(payload, 'wrong-secret');
    expect(() => verifyToken(token)).toThrow();
  });

  it('should throw for malformed token', () => {
    expect(() => verifyToken('not-a-valid-token')).toThrow();
  });
});

describe('authMiddleware', () => {
  it('should return 401 when no authorization header is present', () => {
    const req = createMockRequest(undefined);
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should extract token from Bearer format and call next', () => {
    const payload = { id: 'user123', role: 'admin', email: 'admin@test.com' };
    const token = jwt.sign(payload, TEST_SECRET);
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.id).toBe('user123');
    expect(req.user!.role).toBe('admin');
  });

  it('should accept raw token without Bearer prefix (backward compat)', () => {
    const payload = { id: 'user123', role: 'user', username: 'test' };
    const token = jwt.sign(payload, TEST_SECRET);
    const req = createMockRequest(token);
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.id).toBe('user123');
  });

  it('should return 401 for invalid token', () => {
    const req = createMockRequest('Bearer invalid-token');
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for expired token in Bearer format', () => {
    const payload = { id: 'user123', role: 'admin' };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '-1s' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Bearer prefix is present but token is empty', () => {
    const req = createMockRequest('Bearer ');
    const res = createMockResponse();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  it('should call next when user has admin role', () => {
    const req = createMockRequest() as AuthRequest;
    req.user = { id: 'admin1', role: 'admin', email: 'admin@test.com' };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when user has non-admin role', () => {
    const req = createMockRequest() as AuthRequest;
    req.user = { id: 'user1', role: 'user', username: 'visitor' };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when req.user is undefined', () => {
    const req = createMockRequest() as AuthRequest;
    const res = createMockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for empty role string', () => {
    const req = createMockRequest() as AuthRequest;
    req.user = { id: 'user1', role: '' };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });
});
