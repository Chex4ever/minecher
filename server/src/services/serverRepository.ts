import type { Db } from "../db.js";
import type { MinecraftServer, ServerType, ServerStatus } from "@minecher/types";
import { randomUUID } from "node:crypto";

interface ServerRow {
  id: string;
  name: string;
  type: string;
  version: string;
  jar_path: string | null;
  status: string;
  auto_start: number;
  auto_restart: number;
  restarts_count: number;
  java_path: string | null;
  memory_max_mb: number;
  memory_min_mb: number;
  java_args: string;
  server_props: string;
  port: number;
  created_at: string;
  updated_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
}

export interface ServerCreateInput {
  name: string;
  type: ServerType;
  version: string;
  loaderVersion?: string;
  autoStart?: boolean;
  autoRestart?: boolean;
  memoryMaxMb?: number;
  memoryMinMb?: number;
  port?: number;
  javaPath?: string | null;
  javaArgs?: string[];
  serverProps?: Record<string, string>;
}

export interface ServerUpdateInput {
  name?: string;
  autoStart?: boolean;
  autoRestart?: boolean;
  memoryMaxMb?: number;
  memoryMinMb?: number;
  port?: number;
  javaPath?: string | null;
  javaArgs?: string[];
  serverProps?: Record<string, string>;
}

function toServer(row: ServerRow): MinecraftServer {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ServerType,
    version: row.version,
    jarPath: row.jar_path,
    status: row.status as ServerStatus,
    autoStart: !!row.auto_start,
    autoRestart: !!row.auto_restart,
    restartsCount: row.restarts_count,
    javaPath: row.java_path,
    memoryMaxMb: row.memory_max_mb,
    memoryMinMb: row.memory_min_mb,
    javaArgs: JSON.parse(row.java_args) as string[],
    serverProps: JSON.parse(row.server_props) as Record<string, string>,
    port: row.port,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStartedAt: row.last_started_at,
    lastStoppedAt: row.last_stopped_at,
    pid: null,
    stats: null,
  };
}

export class ServerRepository {
  constructor(private db: Db) {}

  create(input: ServerCreateInput, loaderVersion?: string): MinecraftServer {
    const now = new Date().toISOString();
    const row: ServerRow = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      version: input.version,
      jar_path: loaderVersion ? `${input.version}-${loaderVersion}` : input.version,
      status: "stopped",
      auto_start: input.autoStart ? 1 : 0,
      auto_restart: input.autoRestart !== false ? 1 : 0,
      restarts_count: 0,
      java_path: input.javaPath ?? null,
      memory_max_mb: input.memoryMaxMb ?? 1024,
      memory_min_mb: input.memoryMinMb ?? 1024,
      java_args: input.javaArgs ? JSON.stringify(input.javaArgs) : "[]",
      server_props: input.serverProps ? JSON.stringify(input.serverProps) : "{}",
      port: input.port ?? 25565,
      created_at: now,
      updated_at: now,
      last_started_at: null,
      last_stopped_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO servers (id, name, type, version, jar_path, status, auto_start, auto_restart,
          restarts_count, java_path, memory_max_mb, memory_min_mb, java_args, server_props, port,
          created_at, updated_at, last_started_at, last_stopped_at)
         VALUES (@id, @name, @type, @version, @jar_path, @status, @auto_start, @auto_restart,
          @restarts_count, @java_path, @memory_max_mb, @memory_min_mb, @java_args, @server_props, @port,
          @created_at, @updated_at, @last_started_at, @last_stopped_at)`,
      )
      .run(row);
    return toServer(row);
  }

  all(): MinecraftServer[] {
    const rows = this.db
      .prepare("SELECT * FROM servers ORDER BY created_at ASC")
      .all() as ServerRow[];
    return rows.map(toServer);
  }

  byId(id: string): MinecraftServer | null {
    const row = this.db
      .prepare("SELECT * FROM servers WHERE id = ?")
      .get(id) as ServerRow | undefined;
    return row ? toServer(row) : null;
  }

  update(id: string, patch: ServerUpdateInput): MinecraftServer | null {
    const existing = this.byId(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged: ServerRow = {
      id: existing.id,
      name: patch.name ?? existing.name,
      type: existing.type,
      version: existing.version,
      jar_path: existing.jarPath,
      status: existing.status,
      auto_start: patch.autoStart !== undefined ? (patch.autoStart ? 1 : 0) : existing.autoStart ? 1 : 0,
      auto_restart: patch.autoRestart !== undefined ? (patch.autoRestart ? 1 : 0) : existing.autoRestart ? 1 : 0,
      restarts_count: existing.restartsCount,
      java_path: patch.javaPath !== undefined ? patch.javaPath : existing.javaPath,
      memory_max_mb: patch.memoryMaxMb ?? existing.memoryMaxMb,
      memory_min_mb: patch.memoryMinMb ?? existing.memoryMinMb,
      java_args: patch.javaArgs !== undefined ? JSON.stringify(patch.javaArgs) : JSON.stringify(existing.javaArgs),
      server_props: patch.serverProps !== undefined ? JSON.stringify(patch.serverProps) : JSON.stringify(existing.serverProps),
      port: patch.port ?? existing.port,
      created_at: existing.createdAt,
      updated_at: now,
      last_started_at: existing.lastStartedAt,
      last_stopped_at: existing.lastStoppedAt,
    };
    this.db
      .prepare(
        `UPDATE servers SET name=@name, auto_start=@auto_start, auto_restart=@auto_restart,
          java_path=@java_path, memory_max_mb=@memory_max_mb, memory_min_mb=@memory_min_mb,
          java_args=@java_args, server_props=@server_props, port=@port, updated_at=@updated_at
          WHERE id=@id`,
      )
      .run(merged);
    return toServer(merged);
  }

  setStatus(id: string, status: ServerStatus, startedAt?: string | null, stoppedAt?: string | null): void {
    this.db
      .prepare(
        "UPDATE servers SET status=?, last_started_at=COALESCE(?, last_started_at), last_stopped_at=COALESCE(?, last_stopped_at), updated_at=? WHERE id=?",
      )
      .run(status, startedAt ?? null, stoppedAt ?? null, new Date().toISOString(), id);
  }

  setRestartsCount(id: string, count: number): void {
    this.db
      .prepare("UPDATE servers SET restarts_count=?, updated_at=? WHERE id=?")
      .run(count, new Date().toISOString(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM servers WHERE id=?").run(id);
  }
}
