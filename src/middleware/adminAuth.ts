import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const sessions = new Map<string, number>(); // token → expiry epoch ms

export function createAdminSession(): string {
  const token = uuidv4();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function destroyAdminSession(token: string): void {
  sessions.delete(token);
}

export function isAdminSessionValid(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies.admin_session;
  if (!token || !isAdminSessionValid(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
