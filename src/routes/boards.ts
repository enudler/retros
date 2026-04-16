import { Router, Request, Response } from 'express';
import {
  getBoardBySlug,
  getParticipant,
  upsertParticipant,
  getBoardItems,
  insertItem,
  removeItem,
  getVote,
  upsertVote,
  removeVote,
} from '../database';

const router = Router();

const VALID_CATEGORIES = new Set(['keep', 'improve', 'action']);

// ── GET /api/boards/:slug/me ─────────────────────────────────────────────────
// Returns the caller's session id so the frontend can identify its own items.

router.get('/:slug/me', (req: Request, res: Response) => {
  res.json({ sessionId: req.cookies.session_id as string });
});

// ── GET /api/boards/:slug ────────────────────────────────────────────────────

router.get('/:slug', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  const participant = getParticipant(sid, board.id) ?? null;
  const items = getBoardItems(board.id, sid);

  res.json({ board, participant, items });
});

// ── POST /api/boards/:slug/join ──────────────────────────────────────────────

router.post('/:slug/join', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const { displayName } = req.body as { displayName?: string };
  if (!displayName?.trim()) {
    res.status(400).json({ error: 'Display name is required' }); return;
  }

  const sid = req.cookies.session_id as string;
  upsertParticipant(sid, board.id, displayName.trim());
  res.json({ success: true, displayName: displayName.trim() });
});

// ── POST /api/boards/:slug/items ─────────────────────────────────────────────

router.post('/:slug/items', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  if (!getParticipant(sid, board.id)) {
    res.status(403).json({ error: 'Join the board before adding items' }); return;
  }

  const { category, content } = req.body as { category?: string; content?: string };
  if (!category || !VALID_CATEGORIES.has(category)) {
    res.status(400).json({ error: 'category must be keep | improve | action' }); return;
  }
  if (!content?.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }

  const newId = insertItem(board.id, sid, category, content.trim());
  const items = getBoardItems(board.id, sid);
  const item = items.find(i => i.id === newId);
  res.status(201).json(item);
});

// ── DELETE /api/boards/:slug/items/:id ───────────────────────────────────────

router.delete('/:slug/items/:id', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  const changes = removeItem(id, sid);
  if (changes === 0) {
    res.status(403).json({ error: 'Not your item or item not found' }); return;
  }
  res.json({ success: true });
});

// ── POST /api/boards/:slug/items/:id/vote ────────────────────────────────────
// body: { voteType: 1 | -1 }
// Voting the same direction twice toggles the vote off.

router.post('/:slug/items/:id/vote', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  if (!getParticipant(sid, board.id)) {
    res.status(403).json({ error: 'Join the board before voting' }); return;
  }

  const { voteType } = req.body as { voteType?: number };
  if (voteType !== 1 && voteType !== -1) {
    res.status(400).json({ error: 'voteType must be 1 or -1' }); return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  const existing = getVote(id, sid);
  if (existing?.vote_type === voteType) {
    removeVote(id, sid); // toggle off
  } else {
    upsertVote(id, sid, voteType); // set or flip
  }

  const items = getBoardItems(board.id, sid);
  const updated = items.find(i => i.id === id);
  res.json(updated);
});

// ── DELETE /api/boards/:slug/items/:id/vote ──────────────────────────────────

router.delete('/:slug/items/:id/vote', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid item id' }); return; }

  removeVote(id, sid);
  const items = getBoardItems(board.id, sid);
  const updated = items.find(i => i.id === id);
  res.json(updated);
});

export default router;
