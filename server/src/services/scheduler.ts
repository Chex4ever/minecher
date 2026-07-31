import cron from "cron-parser";
import type { Db } from "../db.js";
import type { AppContext } from "./context.js";
import type { LogStore } from "./logStore.js";
import type { ScheduleInfo } from "@minecher/types";

interface ScheduleRow {
  id: string;
  server_id: string;
  cron: string;
  action: string;
  command: string | null;
  enabled: number;
  created_at: string;
}

export class SchedulerService {
  ctx!: AppContext;
  private timer?: NodeJS.Timeout;
  private lastRun = new Map<string, string>();

  constructor(
    private db: Db,
    private logs: LogStore,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  list(serverId?: string): ScheduleInfo[] {
    const rows = serverId
      ? (this.db.prepare("SELECT * FROM schedules WHERE server_id=? ORDER BY created_at").all(serverId) as ScheduleRow[])
      : (this.db.prepare("SELECT * FROM schedules ORDER BY created_at").all() as ScheduleRow[]);
    return rows.map(toSchedule);
  }

  create(input: {
    serverId: string;
    cron: string;
    action: ScheduleInfo["action"];
    command?: string;
    enabled?: boolean;
  }): ScheduleInfo {
    const server = this.ctx.servers.byId(input.serverId);
    if (!server) throw new Error("Server not found");
    // validate cron
    cron.parseExpression(input.cron);
    const row: ScheduleRow = {
      id: cryptoRandomId(),
      server_id: input.serverId,
      cron: input.cron,
      action: input.action,
      command: input.command ?? null,
      enabled: input.enabled === false ? 0 : 1,
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO schedules (id, server_id, cron, action, command, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.server_id, row.cron, row.action, row.command, row.enabled, row.created_at);
    return toSchedule(row);
  }

  update(id: string, patch: { cron?: string; action?: string; command?: string | null; enabled?: boolean }): ScheduleInfo | null {
    const existing = this.db.prepare("SELECT * FROM schedules WHERE id=?").get(id) as ScheduleRow | undefined;
    if (!existing) return null;
    const merged: ScheduleRow = {
      ...existing,
      cron: patch.cron ?? existing.cron,
      action: patch.action ?? existing.action,
      command: patch.command !== undefined ? patch.command : existing.command,
      enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    };
    if (patch.cron) cron.parseExpression(patch.cron);
    this.db
      .prepare("UPDATE schedules SET cron=?, action=?, command=?, enabled=? WHERE id=?")
      .run(merged.cron, merged.action, merged.command, merged.enabled, merged.id);
    return toSchedule(merged);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM schedules WHERE id=?").run(id);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    for (const schedule of this.list()) {
      if (!schedule.enabled) continue;
      try {
        const expr = cron.parseExpression(schedule.cron);
        const next = expr.next().toDate();
        if (next.getTime() > now.getTime()) continue;
        const key = `${schedule.id}:${next.getTime()}`;
        if (this.lastRun.get(schedule.id) === key) continue;
        this.lastRun.set(schedule.id, key);
        await this.run(schedule);
      } catch (err) {
        this.logs.append(schedule.serverId, "system", `Schedule ${schedule.id} failed: ${String(err)}`);
      }
    }
  }

  private async run(schedule: ScheduleInfo): Promise<void> {
    const { serverId, action } = schedule;
    this.logs.append(serverId, "system", `Running scheduled action "${action}" (${schedule.cron})`);
    switch (action) {
      case "start":
        if (!this.ctx.processes.isRunning(serverId)) {
          await this.ctx.processes.start(serverId);
        }
        break;
      case "stop":
        if (this.ctx.processes.isRunning(serverId)) {
          await this.ctx.processes.stop(serverId);
        }
        break;
      case "restart":
        if (this.ctx.processes.isRunning(serverId)) {
          await this.ctx.processes.stop(serverId);
          await new Promise((r) => setTimeout(r, 800));
        }
        await this.ctx.processes.start(serverId);
        break;
      case "backup":
        await this.ctx.backups.create(serverId);
        break;
      case "command":
        if (schedule.command) {
          this.ctx.processes.sendCommand(serverId, schedule.command);
        }
        break;
    }
  }
}

function toSchedule(row: ScheduleRow): ScheduleInfo {
  return {
    id: row.id,
    serverId: row.server_id,
    cron: row.cron,
    action: row.action as ScheduleInfo["action"],
    command: row.command ?? undefined,
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
