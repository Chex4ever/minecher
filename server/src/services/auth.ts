import crypto from "node:crypto";
import type { Db } from "../db.js";
import type { User } from "@minecher/types";

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: User["role"];
  created_at: string;
}

export interface AuthContext {
  user: User;
}

function hashPassword(password: string, salt: string): string {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

export function createUser(db: Db, username: string, password: string, role: User["role"]): User {
  const row: UserRow = {
    id: crypto.randomUUID(),
    username,
    password_hash: hashPassword(password, crypto.randomBytes(16).toString("hex")),
    role,
    created_at: new Date().toISOString(),
  };
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, row.username, row.password_hash, row.role, row.created_at);
  return toUser(row);
}

export function findUser(db: Db, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function listUsers(db: Db): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[];
  return rows.map(toUser);
}

export function userById(db: Db, id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function checkCredentials(db: Db, username: string, password: string): User | null {
  const row = findUser(db, username);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return toUser(row);
}

function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

export function roleAtLeast(user: User, required: User["role"]): boolean {
  const rank: Record<User["role"], number> = { viewer: 0, operator: 1, admin: 2 };
  return rank[user.role] >= rank[required];
}
