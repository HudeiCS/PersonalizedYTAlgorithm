// Minimal persistence layer — plain JSON file on disk (backend/db/data.json).
// Deliberately NOT a native module (no better-sqlite3, no node-gyp/compiler
// requirement) so `npm install` works identically on Windows/Mac/Linux with
// zero build tools. Fine for local dev / small usage; swap for a real DB if
// you productionize this.
//
// Stores exactly what we need to keep the OAuth consent honest:
//   - the refresh/access token pair the user explicitly granted
//   - the scope string Google actually returned (what they consented to)
//   - lightweight, user-editable preferences (genres, discoverability slider)
// No video/subscription content is cached here; it's fetched live from
// YouTube on each request and only ever kept in memory for the algorithm.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data.json");

function load() {
  if (!fs.existsSync(DB_PATH)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { users: {} };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function defaultUser(id) {
  return {
    id,
    email: null,
    name: null,
    avatar_url: null,
    access_token: null,
    refresh_token: null,
    token_expiry: null,
    granted_scopes: null,
    consented_at: null,
    genres: "[]",
    discoverability: 0.6,
  };
}

export function upsertUser(profile, tokens) {
  const data = load();
  const existing = data.users[profile.id] || defaultUser(profile.id);

  data.users[profile.id] = {
    ...existing,
    email: profile.email,
    name: profile.name,
    avatar_url: profile.picture,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? existing.refresh_token,
    token_expiry: tokens.expiry_date,
    granted_scopes: tokens.scope,
    consented_at: Date.now(),
  };

  save(data);
  return data.users[profile.id];
}

export function getUser(id) {
  const data = load();
  return data.users[id] || undefined;
}

export function updateTokens(id, tokens) {
  const data = load();
  if (!data.users[id]) return;
  data.users[id].access_token = tokens.access_token ?? data.users[id].access_token;
  data.users[id].token_expiry = tokens.expiry_date ?? data.users[id].token_expiry;
  data.users[id].refresh_token = tokens.refresh_token ?? data.users[id].refresh_token;
  save(data);
}

export function setPreferences(id, { genres, discoverability }) {
  const data = load();
  if (!data.users[id]) data.users[id] = defaultUser(id);
  data.users[id].genres = JSON.stringify(genres ?? []);
  data.users[id].discoverability = discoverability ?? 0.6;
  save(data);
  return data.users[id];
}

// Consent revocation: wipes tokens + all stored data for the user, but keeps
// the row so re-consent doesn't collide with anything. This is what a
// "Disconnect YouTube" button in the UI calls.
export function revokeUser(id) {
  const data = load();
  if (!data.users[id]) return;
  data.users[id].access_token = null;
  data.users[id].refresh_token = null;
  data.users[id].token_expiry = null;
  data.users[id].granted_scopes = null;
  data.users[id].consented_at = null;
  save(data);
}
