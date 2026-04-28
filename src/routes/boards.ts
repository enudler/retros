import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
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

// ── GET /api/boards/:slug/export.pdf ────────────────────────────────────────

const SECTION_META = [
  { category: 'keep',    label: 'What went well',  emoji: '✅', rgb: [16, 185, 129]  as [number,number,number] },
  { category: 'improve', label: 'To improve',       emoji: '🔧', rgb: [245, 158, 11] as [number,number,number] },
  { category: 'action',  label: 'Action items',     emoji: '⚡', rgb: [59, 130, 246] as [number,number,number] },
];

router.get('/:slug/export.pdf', (req: Request, res: Response) => {
  const board = getBoardBySlug(req.params.slug);
  if (!board) { res.status(404).json({ error: 'Board not found' }); return; }

  const sid = req.cookies.session_id as string;
  const items = getBoardItems(board.id, sid);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${board.slug}-retro.pdf"`);
  doc.pipe(res);

  // ── Title block ─────────────────────────────────────────────────────────
  doc.fontSize(24).font('Helvetica-Bold').fillColor('#1e293b').text(board.title, { align: 'center' });
  doc.moveDown(0.3);
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Retrospective summary · ${exportDate}`, { align: 'center' });
  doc.moveDown(0.5);

  // Divider
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.moveDown(1);

  // ── Sections ─────────────────────────────────────────────────────────────
  for (const { category, label, rgb } of SECTION_META) {
    const catItems = items
      .filter(i => i.category === category)
      .sort((a, b) => b.vote_score - a.vote_score);

    // Section header background pill
    const headerY = doc.y;
    const [r, g, b] = rgb;
    doc.roundedRect(50, headerY, doc.page.width - 100, 28, 6)
       .fill(`rgb(${r},${g},${b})`);

    doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff')
       .text(`${label}  (${catItems.length})`, 62, headerY + 7);
    doc.moveDown(0.3);
    doc.y = headerY + 38;

    if (catItems.length === 0) {
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#94a3b8')
         .text('  No items.', { indent: 12 });
      doc.moveDown(0.5);
    } else {
      for (const item of catItems) {
        // Check for page overflow
        if (doc.y > doc.page.height - 120) doc.addPage();

        const scoreStr = item.vote_score > 0 ? `+${item.vote_score}` : String(item.vote_score);
        const scoreColor = item.vote_score > 0 ? '#10b981' : item.vote_score < 0 ? '#ef4444' : '#64748b';
        const cardTop = doc.y;
        const cardLeft = 50;
        const cardWidth = doc.page.width - 100;

        // Light card background
        doc.roundedRect(cardLeft, cardTop, cardWidth, 1, 4).fill('#f8fafc');
        const contentX = cardLeft + 12;
        const scoreW = 36;
        const contentW = cardWidth - scoreW - 24;

        // Content text — measure height first
        const savedY = doc.y;
        doc.fontSize(10).font('Helvetica').fillColor('#1e293b');
        const textHeight = doc.heightOfString(item.content, { width: contentW });
        const metaLine = `by ${item.author_name}`;
        const totalCardH = Math.max(textHeight + 22, 42);

        // Draw card background with measured height
        doc.roundedRect(cardLeft, cardTop, cardWidth, totalCardH, 4)
           .fillAndStroke('#f8fafc', '#e2e8f0');

        doc.y = cardTop + 8;
        doc.fontSize(10).font('Helvetica').fillColor('#1e293b')
           .text(item.content, contentX, cardTop + 8, { width: contentW });

        doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
           .text(metaLine, contentX, cardTop + totalCardH - 16, { width: contentW });

        // Vote score badge
        doc.fontSize(10).font('Helvetica-Bold').fillColor(scoreColor)
           .text(scoreStr, cardLeft + cardWidth - scoreW - 4, cardTop + (totalCardH / 2) - 6, {
             width: scoreW, align: 'right',
           });

        doc.y = cardTop + totalCardH + 6;
      }
    }

    doc.moveDown(1);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const pageCount = (doc as any).bufferedPageRange?.()?.count ?? 1;
  doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
     .text(`Generated by Retros · ${board.slug}`, 50, doc.page.height - 40, {
       align: 'center', width: doc.page.width - 100,
     });

  doc.end();
});

export default router;
