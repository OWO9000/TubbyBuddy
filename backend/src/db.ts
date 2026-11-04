import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.mediaDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(config.mediaDir, "cosmetics"), { recursive: true });

export const db = new Database(process.env.DB_FILE ?? path.join(config.dataDir, "burn.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  device_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_streak_day TEXT,
  equipped TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES users(device_id),
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_device ON ledger(device_id);
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  context_key TEXT NOT NULL,
  app_name TEXT NOT NULL,
  text TEXT NOT NULL,
  tone TEXT,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nudges_ctx ON nudges(context_key, used_at);
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  discount_percent INTEGER NOT NULL,
  monthly_cap INTEGER NOT NULL,
  points_price INTEGER NOT NULL,
  terms TEXT NOT NULL,
  image_url TEXT,
  source TEXT NOT NULL DEFAULT 'merchant',
  consent_at INTEGER NOT NULL,
  consent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  device_id TEXT NOT NULL REFERENCES users(device_id),
  code TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',
  proof_result TEXT,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS cosmetics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slot TEXT NOT NULL,
  price INTEGER NOT NULL,
  emoji TEXT,
  image_url TEXT,
  generated INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_cosmetics (
  device_id TEXT NOT NULL REFERENCES users(device_id),
  cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id),
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, cosmetic_id)
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  input TEXT NOT NULL,
  steps TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Lightweight migrations for databases created by earlier builds.
const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
if (!userColumns.some((c) => c.name === "prefs")) {
  db.exec(`ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'`);
}

export const now = () => Date.now();
