import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/retro.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id   INTEGER PRIMARY KEY CHECK(id = 1),
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS boards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slug       TEXT UNIQUE NOT NULL,
      title      TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS board_participants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      board_id     INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, board_id),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id   INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      category   TEXT NOT NULL CHECK(category IN ('keep','improve','action')),
      content    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      vote_type  INTEGER NOT NULL CHECK(vote_type IN (1, -1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, session_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
  `);
}

// ── Admin ────────────────────────────────────────────────────────────────────

export function isAdminSetup(): boolean {
  return !!(db.prepare('SELECT id FROM admin LIMIT 1').get());
}

export function getAdmin(): { id: number; password_hash: string } | undefined {
  return db.prepare('SELECT * FROM admin LIMIT 1').get() as any;
}

export function createAdmin(passwordHash: string): void {
  db.prepare('INSERT INTO admin (id, password_hash) VALUES (1, ?)').run(passwordHash);
}

// ── Boards ───────────────────────────────────────────────────────────────────

export interface Board {
  id: number;
  slug: string;
  title: string;
  created_at: string;
}

export function createBoard(slug: string, title: string): Board {
  db.prepare('INSERT INTO boards (slug, title) VALUES (?, ?)').run(slug, title);
  return db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug) as Board;
}

export function getBoardBySlug(slug: string): Board | undefined {
  return db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug) as Board | undefined;
}

export function getAllBoards(): Board[] {
  return db.prepare('SELECT * FROM boards ORDER BY created_at DESC').all() as Board[];
}

export function deleteBoardById(id: number): void {
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
}

// ── Participants ─────────────────────────────────────────────────────────────

export interface Participant {
  id: number;
  session_id: string;
  board_id: number;
  display_name: string;
}

export function getParticipant(sessionId: string, boardId: number): Participant | undefined {
  return db.prepare(
    'SELECT * FROM board_participants WHERE session_id = ? AND board_id = ?'
  ).get(sessionId, boardId) as Participant | undefined;
}

export function upsertParticipant(sessionId: string, boardId: number, displayName: string): void {
  db.prepare(`
    INSERT INTO board_participants (session_id, board_id, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, board_id) DO UPDATE SET display_name = excluded.display_name
  `).run(sessionId, boardId, displayName);
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface Item {
  id: number;
  category: 'keep' | 'improve' | 'action';
  content: string;
  session_id: string;
  author_name: string;
  vote_score: number;
  my_vote: 1 | -1 | null;
  created_at: string;
  upvoters: string[];
  downvoters: string[];
}

export function getBoardItems(boardId: number, currentSessionId: string): Item[] {
  const rows = db.prepare(`
    SELECT
      i.id,
      i.category,
      i.content,
      i.session_id,
      i.created_at,
      COALESCE(bp.display_name, 'Anonymous') AS author_name,
      COALESCE(SUM(v.vote_type), 0)           AS vote_score,
      MAX(CASE WHEN v.session_id = @sid THEN v.vote_type ELSE NULL END) AS my_vote,
      (
        SELECT json_group_array(COALESCE(bp2.display_name, 'Anonymous'))
        FROM votes v2
        LEFT JOIN board_participants bp2
          ON v2.session_id = bp2.session_id AND bp2.board_id = i.board_id
        WHERE v2.item_id = i.id AND v2.vote_type = 1
      ) AS upvoters_json,
      (
        SELECT json_group_array(COALESCE(bp2.display_name, 'Anonymous'))
        FROM votes v2
        LEFT JOIN board_participants bp2
          ON v2.session_id = bp2.session_id AND bp2.board_id = i.board_id
        WHERE v2.item_id = i.id AND v2.vote_type = -1
      ) AS downvoters_json
    FROM items i
    LEFT JOIN board_participants bp
      ON i.session_id = bp.session_id AND i.board_id = bp.board_id
    LEFT JOIN votes v ON i.id = v.item_id
    WHERE i.board_id = @boardId
    GROUP BY i.id
    ORDER BY i.created_at ASC
  `).all({ sid: currentSessionId, boardId }) as any[];

  return rows.map(row => ({
    ...row,
    upvoters:   JSON.parse(row.upvoters_json   ?? '[]') as string[],
    downvoters: JSON.parse(row.downvoters_json ?? '[]') as string[],
    upvoters_json:   undefined,
    downvoters_json: undefined,
  })) as Item[];
}

export function insertItem(boardId: number, sessionId: string, category: string, content: string): number {
  const result = db.prepare(
    'INSERT INTO items (board_id, session_id, category, content) VALUES (?, ?, ?, ?)'
  ).run(boardId, sessionId, category, content);
  return result.lastInsertRowid as number;
}

export function removeItem(id: number, sessionId: string): number {
  const result = db.prepare('DELETE FROM items WHERE id = ? AND session_id = ?').run(id, sessionId);
  return result.changes;
}

// ── Votes ────────────────────────────────────────────────────────────────────

export function getVote(itemId: number, sessionId: string): { vote_type: number } | undefined {
  return db.prepare('SELECT vote_type FROM votes WHERE item_id = ? AND session_id = ?')
    .get(itemId, sessionId) as any;
}

export function upsertVote(itemId: number, sessionId: string, voteType: number): void {
  db.prepare(`
    INSERT INTO votes (item_id, session_id, vote_type)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id, session_id) DO UPDATE SET vote_type = excluded.vote_type
  `).run(itemId, sessionId, voteType);
}

export function removeVote(itemId: number, sessionId: string): void {
  db.prepare('DELETE FROM votes WHERE item_id = ? AND session_id = ?').run(itemId, sessionId);
}

export default db;
