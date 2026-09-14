import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/history.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    navigator TEXT NOT NULL CHECK (navigator IN ('gemara', 'tursa')),
    work TEXT NOT NULL,
    item INTEGER NOT NULL CHECK (item > 0),
    last_opened_at TEXT NOT NULL,
    UNIQUE (user_id, navigator, work, item)
  );
  CREATE INDEX IF NOT EXISTS history_user_last_opened
    ON history (user_id, last_opened_at DESC);
`);

const selectHistory = db.prepare(`
  SELECT navigator, work, item, last_opened_at AS lastOpenedAt
  FROM history
  WHERE user_id = ?
  ORDER BY last_opened_at DESC
  LIMIT ?
`);

const upsertHistory = db.prepare(`
  INSERT INTO history (user_id, navigator, work, item, last_opened_at)
  VALUES (@userId, @navigator, @work, @item, @lastOpenedAt)
  ON CONFLICT (user_id, navigator, work, item)
  DO UPDATE SET last_opened_at = excluded.last_opened_at
`);

export function getHistory(userId, limit = 200) {
  return selectHistory.all(userId, limit);
}

export function recordHistory(entry) {
  upsertHistory.run(entry);
}
