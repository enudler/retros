import { Router, Request, Response } from 'express';
import {
  getBoardBySlug,
  getBoardItems,
  insertItem,
  removeItem,
  getVote,
  upsertVote,
  removeVote,
} from '../database';
import { requireAuth } from '../middleware/adminAuth';

const router = Router();
router.use(requireAuth);

const VALID_CATEGORIES = new Set(['keep', 'improve', 'action']);

// ── GET /api/boards/:slug/me ─────────────────────────────────────────────────

router.get('/:slug/me', (req: Request, res: Response) => {
  res.json({ userId: req.user!.google_id, user: req.user });
});

// ── GET /api/boards/:slug ────────────────────────────────────────────────────

router.get('/:slug', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const items = getBoardItems(board.id, req.user!.google_id);
  res.json({ board, user: req.user, items });
});

// ── POST /api/boards/:slug/items ─────────────────────────────────────────────

router.post('/:slug/items', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const { category, content } = req.body as { category?: string; content?: string };
  if (!category || !VALID_CATEGORIES.has(category)) {
    res.status(400).json({ error: 'category must be keep | improve | action' }); return;
  }
  if (!content?.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }

  const newId = insertItem(board.id, req.user!.google_id, category, content.trim());
  const items = getBoardItems(board.id, req.user!.google_id);
  res.status(201).json(items.find(i => i.id === newId));
});

// ── DELETE /api/boards/:slug/items/:id ───────────────────────────────────────

router.delete('/:slug/items/:id', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  const changes = removeItem(id, req.user!.google_id);
  if (changes === 0) {
    res.status(403).json({ error: 'Not your item or item not found' }); return;
  }
  res.json({ success: true });
});

// ── POST /api/boards/:slug/items/:id/vote ────────────────────────────────────

router.post('/:slug/items/:id/vote', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const { voteType } = req.body as { voteType?: number };
  if (voteType !== 1 && voteType !== -1) {
    res.status(400).json({ error: 'voteType must be 1 or -1' }); return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  const uid      = req.user!.google_id;
  const existing = getVote(id, uid);
  if (existing?.vote_type === voteType) {
    removeVote(id, uid);
  } else {
    upsertVote(id, uid, voteType);
  }

  const items = getBoardItems(board.id, uid);
  res.json(items.find(i => i.id === id));
});

// ── DELETE /api/boards/:slug/items/:id/vote ──────────────────────────────────

router.delete('/:slug/items/:id/vote', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const id  = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  const uid = req.user!.google_id;
  removeVote(id, uid);
  const items = getBoardItems(board.id, uid);
  res.json(items.find(i => i.id === id));
});

export default router;
