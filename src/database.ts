import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import './types';

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
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id  TEXT UNIQUE NOT NULL,
      email      TEXT NOT NULL,
      name       TEXT NOT NULL,
      picture    TEXT,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS boards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slug       TEXT UNIQUE NOT NULL,
      title      TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id   INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      category   TEXT NOT NULL CHECK(category IN ('keep','improve','action')),
      content    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      vote_type  INTEGER NOT NULL CHECK(vote_type IN (1, -1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, user_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
  `);
}

// ── Users ────────────────────────────────────────────────────────────────────

export function getUserByGoogleId(googleId: string): Express.User | undefined {
  return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as Express.User | undefined;
}

export function upsertUser(
  googleId: string,
  email: string,
  name: string,
  picture: string | null,
  isAdmin: number,
): Express.User {
  db.prepare(`
    INSERT INTO users (google_id, email, name, picture, is_admin)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_id) DO UPDATE SET
      email    = excluded.email,
      name     = excluded.name,
      picture  = excluded.picture,
      is_admin = MAX(is_admin, excluded.is_admin)
  `).run(googleId, email, name, picture, isAdmin);
  return getUserByGoogleId(googleId)!;
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

// ── Items ────────────────────────────────────────────────────────────────────

export interface Item {
  id: number;
  category: 'keep' | 'improve' | 'action';
  content: string;
  user_id: string;
  author_name: string;
  author_picture: string | null;
  vote_score: number;
  my_vote: 1 | -1 | null;
  created_at: string;
  upvoters: string[];
  downvoters: string[];
}

export function getBoardItems(boardId: number, currentUserId: string): Item[] {
  const rows = db.prepare(`
    SELECT
      i.id,
      i.category,
      i.content,
      i.user_id,
      i.created_at,
      COALESCE(u.name,    'Unknown') AS author_name,
      u.picture                      AS author_picture,
      COALESCE(SUM(v.vote_type), 0)  AS vote_score,
      MAX(CASE WHEN v.user_id = @uid THEN v.vote_type ELSE NULL END) AS my_vote,
      (
        SELECT json_group_array(COALESCE(u2.name, 'Unknown'))
        FROM votes v2
        LEFT JOIN users u2 ON v2.user_id = u2.google_id
        WHERE v2.item_id = i.id AND v2.vote_type = 1
      ) AS upvoters_json,
      (
        SELECT json_group_array(COALESCE(u2.name, 'Unknown'))
        FROM votes v2
        LEFT JOIN users u2 ON v2.user_id = u2.google_id
        WHERE v2.item_id = i.id AND v2.vote_type = -1
      ) AS downvoters_json
    FROM items i
    LEFT JOIN users u ON i.user_id = u.google_id
    LEFT JOIN votes v ON i.id = v.item_id
    WHERE i.board_id = @boardId
    GROUP BY i.id
    ORDER BY i.created_at ASC
  `).all({ uid: currentUserId, boardId }) as any[];

  return rows.map(row => ({
    ...row,
    upvoters:        JSON.parse(row.upvoters_json   ?? '[]') as string[],
    downvoters:      JSON.parse(row.downvoters_json ?? '[]') as string[],
    upvoters_json:   undefined,
    downvoters_json: undefined,
  })) as Item[];
}

export function insertItem(boardId: number, userId: string, category: string, content: string): number {
  const result = db.prepare(
    'INSERT INTO items (board_id, user_id, category, content) VALUES (?, ?, ?, ?)'
  ).run(boardId, userId, category, content);
  return result.lastInsertRowid as number;
}

export function removeItem(id: number, userId: string): number {
  const result = db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes;
}

// ── Votes ────────────────────────────────────────────────────────────────────

export function getVote(itemId: number, userId: string): { vote_type: number } | undefined {
  return db.prepare('SELECT vote_type FROM votes WHERE item_id = ? AND user_id = ?')
    .get(itemId, userId) as any;
}

export function upsertVote(itemId: number, userId: string, voteType: number): void {
  db.prepare(`
    INSERT INTO votes (item_id, user_id, vote_type)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id, user_id) DO UPDATE SET vote_type = excluded.vote_type
  `).run(itemId, userId, voteType);
}

export function removeVote(itemId: number, userId: string): void {
  db.prepare('DELETE FROM votes WHERE item_id = ? AND user_id = ?').run(itemId, userId);
}

export default db;
