import { Router, Request, Response } from 'express';
import { getAllBoards, createBoard, deleteBoardById } from '../database';
import { requireAdmin } from '../middleware/adminAuth';

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

router.get('/boards', requireAdmin, (_req: Request, res: Response) => {
  res.json(getAllBoards());
});

router.post('/boards', requireAdmin, (req: Request, res: Response) => {
  const { title } = req.body as { title?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  const board = createBoard(toSlug(title.trim()), title.trim());
  res.status(201).json(board);
});

router.delete('/boards/:id', requireAdmin, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid board id' }); return; }
  deleteBoardById(id);
  res.json({ success: true });
});

export default router;
