import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import { env } from '../config/env';
import { AuthRequest, verifyToken } from '../middlewares/auth';

const SALT_ROUNDS = 10;

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, username, password, passwordConf, role } = req.body;

    if (!name || !username || !password || !passwordConf || !role) {
      res.status(400).json({ message: 'All fields are required' });
      return;
    }

    if (password !== passwordConf) {
      res.status(400).json({ message: 'Passwords do not match' });
      return;
    }

    const existing = await User.findOne({ username });
    if (existing) {
      res.status(409).json({ message: 'Username already exists' });
      return;
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ name, username, hash, role, contacts: [] });

    res.status(201).json({ message: `User ${user.username} created successfully` });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const signin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      res.status(400).json({ message: 'All fields are required' });
      return;
    }

    const user = await User.findOne({ username });
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    if (user.role !== role) {
      res.status(401).json({ message: 'Please choose the correct role' });
      return;
    }

    const valid = await bcrypt.compare(password, user.hash);
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { id: user._id.toString(), username: user.username, role: user.role },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      id: user._id,
      name: user.name,
      username: user.username,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const auth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      res.status(401).json({ message: 'Token required' });
      return;
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.id);
    if (!user) {
      res.status(401).json({ message: 'User not found' });
      return;
    }

    res.status(200).json({
      id: user._id,
      name: user.name,
      username: user.username,
      role: user.role,
      token,
    });
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};
