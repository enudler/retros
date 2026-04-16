import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  isAdminSetup,
  getAdmin,
  createAdmin,
  getAllBoards,
  createBoard,
  deleteBoardById,
} from '../database';
import {
  createAdminSession,
  destroyAdminSession,
  isAdminSessionValid,
  requireAdmin,
} from '../middleware/adminAuth';

const router = Router();

function toSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') +
    '-' +
    Date.now().toString(36)
  );
}

// ── Public ──────────────────────────────────────────────────────────────────

router.get('/status', (req: Request, res: Response) => {
  const setup = isAdminSetup();
  const loggedIn = isAdminSessionValid(req.cookies.admin_session ?? '');
  res.json({ setup, loggedIn });
});

router.post('/setup', (req: Request, res: Response) => {
  if (isAdminSetup()) {
    res.status(400).json({ error: 'Admin already configured' });
    return;
  }
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }
  createAdmin(bcrypt.hashSync(password, 12));
  const token = createAdminSession();
  res.cookie('admin_session', token, cookieOpts());
  res.json({ success: true });
});

router.post('/login', (req: Request, res: Response) => {
  if (!isAdminSetup()) {
    res.status(400).json({ error: 'Admin not configured yet' });
    return;
  }
  const { password } = req.body as { password?: string };
  const admin = getAdmin();
  if (!password || !admin || !bcrypt.compareSync(password, admin.password_hash)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  const token = createAdminSession();
  res.cookie('admin_session', token, cookieOpts());
  res.json({ success: true });
});

router.post('/logout', requireAdmin, (req: Request, res: Response) => {
  destroyAdminSession(req.cookies.admin_session);
  res.clearCookie('admin_session');
  res.json({ success: true });
});

// ── Protected ────────────────────────────────────────────────────────────────

router.get('/boards', requireAdmin, (_req: Request, res: Response) => {
  res.json(getAllBoards());
});

router.post('/boards', requireAdmin, (req: Request, res: Response) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  const slug = toSlug(title.trim());
  const board = createBoard(slug, title.trim());
  res.status(201).json(board);
});

router.delete('/boards/:id', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid board id' });
    return;
  }
  deleteBoardById(id);
  res.json({ success: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function cookieOpts() {
  return {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'strict' as const,
  };
}

export default router;
