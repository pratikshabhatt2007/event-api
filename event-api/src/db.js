import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date_time   TEXT NOT NULL,
  venue       TEXT NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  category    TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_date     ON events(date_time);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_reg_event       ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_user        ON registrations(user_id);
`;

export function createDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Create the admin account from env vars if it does not exist yet. */
export function seedAdmin(db, { adminEmail, adminPassword, adminName }) {
  if (!adminEmail || !adminPassword) return null;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    return existing.id;
  }
  const hash = bcrypt.hashSync(adminPassword, 10);
  const info = db
    .prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')")
    .run(adminName, adminEmail, hash);
  return Number(info.lastInsertRowid);
}
