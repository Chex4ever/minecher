import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import type { ZipArchive } from "archiver";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import type { ServerRepository } from "./serverRepository.js";
import type { ProcessManager } from "./processManager.js";
import type { LogStore } from "./logStore.js";
import { subDir } from "../config.js";
import type { BackupInfo } from "@minecher/types";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as { ZipArchive: typeof ZipArchive };

const EXCLUDE = new Set(["logs", "server.jar", "fabric-server.jar"]);

export class BackupService {
  constructor(
    private config: AppConfig,
    private db: Db,
    private servers: ServerRepository,
    private processes: ProcessManager,
    private logs: LogStore,
  ) {}

  private backupsDir(serverId: string): string {
    return subDir(this.config, "backups", serverId);
  }

  list(serverId: string): BackupInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM backups WHERE server_id=? ORDER BY created_at DESC")
      .all(serverId) as {
      id: string;
      server_id: string;
      path: string;
      size_bytes: number;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      serverId: r.server_id,
      path: r.path,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    }));
  }

  async create(serverId: string): Promise<BackupInfo> {
    const server = this.servers.byId(serverId);
    if (!server) throw new Error("Server not found");
    const srcDir = this.processes.serverDir(server);
    if (!fs.existsSync(srcDir)) throw new Error("Server directory does not exist");

    const id = crypto.randomUUID();
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    const target = path.join(this.backupsDir(serverId), name);

    this.logs.append(serverId, "system", `Creating backup ${id}...`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(target);
      const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.glob("**/*", {
        cwd: srcDir,
        dot: true,
        ignore: [...EXCLUDE],
      });
      void archive.finalize();
    });

    const size = fs.statSync(target).size;
    this.db
      .prepare("INSERT INTO backups (id, server_id, path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, serverId, target, size, new Date().toISOString());
    this.logs.append(serverId, "system", `Backup ${id} created (${formatBytes(size)})`);

    return { id, serverId, path: target, sizeBytes: size, createdAt: new Date().toISOString() };
  }

  async restore(serverId: string, backupId: string): Promise<void> {
    const server = this.servers.byId(serverId);
    if (!server) throw new Error("Server not found");
    const backup = this.db
      .prepare("SELECT * FROM backups WHERE id=? AND server_id=?")
      .get(backupId, serverId) as { path: string } | undefined;
    if (!backup) throw new Error("Backup not found");
    if (!fs.existsSync(backup.path)) throw new Error("Backup file is missing");

    if (this.processes.isRunning(serverId)) {
      throw new Error("Stop the server before restoring");
    }

    this.logs.append(serverId, "system", `Restoring backup ${backupId}...`);
    const srcDir = this.processes.serverDir(server);
    const staging = `${srcDir}.restore-${Date.now()}`;
    fs.mkdirSync(staging, { recursive: true });

    new AdmZip(backup.path).extractAllTo(staging, true);

    const trash = `${srcDir}.old-${Date.now()}`;
    if (fs.existsSync(srcDir)) fs.renameSync(srcDir, trash);
    fs.renameSync(staging, srcDir);
    fs.rmSync(trash, { recursive: true, force: true });
    this.logs.append(serverId, "system", `Backup ${backupId} restored`);
  }

  delete(backupId: string): void {
    const backup = this.db.prepare("SELECT * FROM backups WHERE id=?").get(backupId) as
      | { path: string }
      | undefined;
    if (!backup) return;
    fs.rmSync(backup.path, { force: true });
    this.db.prepare("DELETE FROM backups WHERE id=?").run(backupId);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
