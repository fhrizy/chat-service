import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  id: string;
  username?: string;
  email?: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

/**
 * Verify JWT token and extract payload.
 * Validates that required claims (id, role) are present.
 */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  if (!decoded.id || !decoded.role) {
    throw new Error('Invalid token payload: missing required claims (id, role)');
  }
  return decoded;
}

/**
 * Express middleware: verify Authorization header JWT.
 * Supports "Bearer <token>" format as per Requirement 6.6.
 */
export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ message: 'Token required' });
    return;
  }

  // Extract token from "Bearer <token>" format
  let token: string;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Backward compatibility: accept raw token without Bearer prefix
    token = authHeader;
  }

  if (!token) {
    res.status(401).json({ message: 'Token required' });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/**
 * Express middleware: require admin role.
 * Must be used AFTER authMiddleware in route chains.
 * Checks that req.user.role === 'admin'.
 */
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || req.user.role !== 'admin') {
    res.status(401).json({ message: 'Admin access required' });
    return;
  }
  next();
};
