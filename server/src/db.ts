import Database from "better-sqlite3";
import { AppConfig, subDir } from "./config.js";
import path from "node:path";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  email TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  jar_path TEXT,
  status TEXT NOT NULL DEFAULT 'stopped',
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_restart INTEGER NOT NULL DEFAULT 1,
  restarts_count INTEGER NOT NULL DEFAULT 0,
  java_path TEXT,
  memory_max_mb INTEGER NOT NULL DEFAULT 1024,
  memory_min_mb INTEGER NOT NULL DEFAULT 1024,
  java_args TEXT NOT NULL DEFAULT '[]',
  server_props TEXT NOT NULL DEFAULT '{}',
  port INTEGER NOT NULL DEFAULT 25565,
  velocity_proxy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_started_at TEXT,
  last_stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS log_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  stream TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_server_ts ON log_index(server_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_ts ON log_index(timestamp);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  cron TEXT NOT NULL,
  action TEXT NOT NULL,
  command TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_builds (
  id TEXT PRIMARY KEY,
  launcher_type TEXT NOT NULL,
  mc_version TEXT NOT NULL,
  loader_version TEXT,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER,
  zip_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function openDb(config: AppConfig): Db {
  const dbDir = subDir(config, "db");
  const db = new Database(path.join(dbDir, "minecher.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const cols = db.prepare("PRAGMA table_info(servers)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "pid")) {
    db.exec("ALTER TABLE servers ADD COLUMN pid INTEGER");
  }
  if (!cols.some((c) => c.name === "velocity_proxy_id")) {
    db.exec("ALTER TABLE servers ADD COLUMN velocity_proxy_id TEXT");
  }
  const usersCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!usersCols.some((c) => c.name === "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  }
  if (!usersCols.some((c) => c.name === "avatar")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
  }
}
