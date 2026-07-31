import fs from "node:fs";
import path from "node:path";
import { AppConfig, subDir } from "../config.js";
import { EventBus } from "./eventBus.js";
import type { Db } from "../db.js";
import type { LogEntry } from "@minecher/types";

type LogStream = LogEntry["stream"];
type LogLevel = LogEntry["level"];

export function classifyStream(stream: LogStream, message: string): LogLevel {
  if (stream === "stderr") return "error";
  if (/\b(WARN|WARNING)\b/.test(message)) return "warn";
  if (/\b(ERROR|FATAL|SEVERE)\b/.test(message)) return "error";
  if (/\b(DEBUG|TRACE)\b/.test(message)) return "debug";
  return "info";
}

export class LogStore {
  private handles = new Map<string, fs.WriteStream>();

  constructor(
    private config: AppConfig,
    private db: Db,
    private events: EventBus,
  ) {}

  private logsDir(): string {
    return subDir(this.config, "logs");
  }

  private fileFor(serverId: string, date: string): string {
    return path.join(this.logsDir(), serverId, `${date}.log`);
  }

  private getHandle(serverId: string): fs.WriteStream {
    const date = new Date().toISOString().slice(0, 10);
    const file = this.fileFor(serverId, date);
    const key = `${serverId}:${date}`;
    let handle = this.handles.get(key);
    if (!handle || handle.closed || handle.destroyed || !handle.writable) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      handle = this.open(file);
      this.handles.set(key, handle);
      if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > this.config.logMaxBytes) {
        this.handles.delete(key);
        handle.end();
        fs.renameSync(file, `${file}.1`);
        handle = this.open(file);
        this.handles.set(key, handle);
      }
    }
    return handle;
  }

  private open(file: string): fs.WriteStream {
    const stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => {});
    return stream;
  }

  append(serverId: string, stream: LogStream, message: string): LogEntry {
    const entry: LogEntry = {
      id: cryptoRandomId(),
      serverId,
      timestamp: new Date().toISOString(),
      stream,
      level: classifyStream(stream, message),
      message,
    };
    try {
      const handle = this.getHandle(serverId);
      if (handle.writable) {
        handle.write(`${entry.timestamp} [${stream.toUpperCase()}] ${message}\n`);
      }
    } catch {
      /* logging must never throw */
    }
    try {
      this.db
        .prepare(
          "INSERT INTO log_index (server_id, timestamp, stream, level, message) VALUES (?, ?, ?, ?, ?)",
        )
        .run(entry.serverId, entry.timestamp, entry.stream, entry.level, entry.message);
    } catch {
      /* ignore */
    }
    this.events.emitServerEvent({ type: "log", ...entry });
    return entry;
  }

  query(serverId: string, opts: { offset?: number; limit?: number; q?: string; stream?: string; level?: string } = {}): LogEntry[] {
    const limit = Math.min(opts.limit ?? 200, 2000);
    const offset = opts.offset ?? 0;
    const where: string[] = ["server_id = ?"];
    const args: unknown[] = [serverId];
    if (opts.q) {
      where.push("message LIKE ?");
      args.push(`%${opts.q}%`);
    }
    if (opts.stream) {
      where.push("stream = ?");
      args.push(opts.stream);
    }
    if (opts.level && opts.level !== "all") {
      where.push("level = ?");
      args.push(opts.level);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM log_index WHERE ${where.join(" AND ")}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as {
      id: number;
      server_id: string;
      timestamp: string;
      stream: LogStream;
      level: LogLevel;
      message: string;
    }[];
    return rows
      .reverse()
      .map((r) => ({
        id: String(r.id),
        serverId: r.server_id,
        timestamp: r.timestamp,
        stream: r.stream,
        level: r.level,
        message: r.message,
      }));
  }

  close(): void {
    for (const handle of this.handles.values()) {
      handle.end();
    }
    this.handles.clear();
  }
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
