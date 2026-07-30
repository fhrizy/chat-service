import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { verifyToken, authMiddleware, requireAdmin, AuthRequest } from '../../middlewares/auth';
import { Response, NextFunction } from 'express';

jest.mock('../../config/env', () => ({
  env: { JWT_SECRET: 'test-secret-for-property-tests' },
}));

const TEST_SECRET = 'test-secret-for-property-tests';

function createMockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('Feature: live-chat, Property 12: Role-based access control', () => {
  it('non-admin role tokens rejected with 401', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => s !== 'admin'),
        (role) => {
          const req = { user: { id: 'user1', role } } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          requireAdmin(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('admin role token passes through to next()', () => {
    const req = { user: { id: 'admin1', role: 'admin' } } as unknown as AuthRequest;
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('Feature: live-chat, Property 13: Invalid token rejection', () => {
  it('malformed tokens rejected with 401 + message field', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => {
          // Filter out strings that could accidentally be valid JWTs
          const parts = s.split('.');
          return parts.length !== 3;
        }),
        (malformedToken) => {
          const req = {
            headers: { authorization: `Bearer ${malformedToken}` },
          } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.any(String) })
          );
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tokens signed with wrong secret rejected with 401 + message field', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 32 }).filter(s => s !== TEST_SECRET),
        fc.string({ minLength: 1, maxLength: 20 }),
        (wrongSecret, userId) => {
          const token = jwt.sign({ id: userId, role: 'admin' }, wrongSecret);
          const req = {
            headers: { authorization: `Bearer ${token}` },
          } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.any(String) })
          );
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tokens missing required claims (no id) rejected with 401 + message field', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (role) => {
          // Token has role but no id
          const token = jwt.sign({ role }, TEST_SECRET);
          const req = {
            headers: { authorization: `Bearer ${token}` },
          } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.any(String) })
          );
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tokens missing required claims (no role) rejected with 401 + message field', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (userId) => {
          // Token has id but no role
          const token = jwt.sign({ id: userId }, TEST_SECRET);
          const req = {
            headers: { authorization: `Bearer ${token}` },
          } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.any(String) })
          );
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('expired tokens rejected with 401 + message field', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (userId, role) => {
          // Create a token that expired 1 hour ago
          const token = jwt.sign(
            { id: userId, role, exp: Math.floor(Date.now() / 1000) - 3600 },
            TEST_SECRET
          );
          const req = {
            headers: { authorization: `Bearer ${token}` },
          } as unknown as AuthRequest;
          const res = createMockRes();
          const next: NextFunction = jest.fn();

          authMiddleware(req, res, next);

          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.any(String) })
          );
          expect(next).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('missing authorization header rejected with 401 + message field', () => {
    const req = {
      headers: {},
    } as unknown as AuthRequest;
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
