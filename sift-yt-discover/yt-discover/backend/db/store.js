// Minimal persistence layer. SQLite file lives at backend/db/data.sqlite.
// Stores exactly what we need to keep the OAuth consent honest:
//   - the refresh/access token pair the user explicitly granted
//   - the scope string Google actually returned (what they consented to)
//   - lightweight, user-editable preferences (genres, discoverability slider)
// No video/subscription content is cached here; it's fetched live from
// YouTube on each request and only ever kept in memory for the algorithm.

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "data.sqlite"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,          -- Google account id (sub claim)
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expiry INTEGER,
    granted_scopes TEXT,          -- exact scope string Google returned
    consented_at INTEGER,
    genres TEXT DEFAULT '[]',        -- JSON array of genre/topic strings
    discoverability REAL DEFAULT 0.6 -- 0 = mainstream ok, 1 = small creators only
  );
`);

export function upsertUser(profile, tokens) {
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(profile.id);
  const now = Date.now();

  if (existing) {
    db.prepare(`
      UPDATE users SET
        email = ?, name = ?, avatar_url = ?,
        access_token = ?, refresh_token = COALESCE(?, refresh_token),
        token_expiry = ?, granted_scopes = ?, consented_at = ?
      WHERE id = ?
    `).run(
      profile.email, profile.name, profile.picture,
      tokens.access_token, tokens.refresh_token ?? null,
      tokens.expiry_date, tokens.scope, now,
      profile.id
    );
  } else {
    db.prepare(`
      INSERT INTO users
        (id, email, name, avatar_url, access_token, refresh_token, token_expiry, granted_scopes, consented_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.id, profile.email, profile.name, profile.picture,
      tokens.access_token, tokens.refresh_token ?? null,
      tokens.expiry_date, tokens.scope, now
    );
  }
  return getUser(profile.id);
}

export function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function updateTokens(id, tokens) {
  db.prepare(`
    UPDATE users SET access_token = ?, token_expiry = ?,
      refresh_token = COALESCE(?, refresh_token)
    WHERE id = ?
  `).run(tokens.access_token, tokens.expiry_date, tokens.refresh_token ?? null, id);
}

export function setPreferences(id, { genres, discoverability }) {
  db.prepare("UPDATE users SET genres = ?, discoverability = ? WHERE id = ?")
    .run(JSON.stringify(genres ?? []), discoverability ?? 0.6, id);
  return getUser(id);
}

// Consent revocation: wipes tokens + all stored data for the user, but keeps
// the row so re-consent doesn't collide with foreign keys elsewhere. This is
// what a "Disconnect YouTube" button in the UI calls.
export function revokeUser(id) {
  db.prepare(`
    UPDATE users SET access_token = NULL, refresh_token = NULL,
      token_expiry = NULL, granted_scopes = NULL, consented_at = NULL
    WHERE id = ?
  `).run(id);
}

export default db;
