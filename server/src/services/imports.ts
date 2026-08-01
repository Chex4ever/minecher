import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import type { ZipArchive } from "archiver";
import type { MinecraftServer, ServerType } from "@minecher/types";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import type { ServerRepository } from "./serverRepository.js";
import type { ProcessManager } from "./processManager.js";
import type { LogStore } from "./logStore.js";
import { subDir } from "../config.js";
import { isPortBlockFree, nextFreePort, validatePort } from "./ports.js";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as { ZipArchive: typeof ZipArchive };

const MCS_FORMAT = 1;

const COPY_EXCLUDE = new Set(["logs", "backups", "session.lock", "usercache.json", "mcs.json"]);
const EXPORT_EXCLUDE = ["logs/**", "**/*.log", "session.lock", "forwarding.secret"];

export interface ImportPathInput {
  path: string;
  name?: string;
  type?: ServerType;
  version?: string;
  port?: number;
  javaPath?: string | null;
  memoryMaxMb?: number;
  memoryMinMb?: number;
}

export interface McSMetadata {
  format: number;
  name: string;
  type: ServerType;
  version: string;
  memoryMaxMb: number;
  memoryMinMb: number;
  javaArgs: string[];
  javaPath: string | null;
  serverProps: Record<string, string>;
  port: number;
  autoStart: boolean;
  autoRestart: boolean;
  velocityProxyId?: string | null;
  exportedAt: string;
}

function shouldCopy(src: string): boolean {
  const base = path.basename(src);
  if (COPY_EXCLUDE.has(base)) return false;
  if (base.endsWith(".log") || base.endsWith(".tmp") || base.endsWith(".mcs")) return false;
  return true;
}

function detectType(dir: string): ServerType {
  const entries = fs.readdirSync(dir);
  if (entries.some((n) => n === "fabric-server.jar") || entries.some((n) => n.endsWith(".jar") && /fabric/i.test(n))) {
    return "fabric";
  }
  if (fs.statSync(path.join(dir, "versions"), { throwIfNoEntry: false })?.isDirectory()) return "paper";
  if (entries.includes("spigot.yml")) return "spigot";
  if (fs.statSync(path.join(dir, "libraries"), { throwIfNoEntry: false })?.isDirectory()) return "forge";
  return "custom";
}

function findJar(dir: string): string | null {
  let best: { name: string; size: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".jar")) continue;
    if (name === "server.jar") return name;
    const size = fs.statSync(path.join(dir, name)).size;
    if (!best || size > best.size) best = { name, size };
  }
  return best?.name ?? null;
}

function expectedJar(type: ServerType): string {
  return type === "fabric" ? "fabric-server.jar" : "server.jar";
}

function readProps(dir: string): Map<string, string> {
  const byKey = new Map<string, string>();
  const file = path.join(dir, "server.properties");
  if (!fs.existsSync(file)) return byKey;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) byKey.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return byKey;
}

function resolveVelocityProxy(db: Db, id?: string | null): string | null {
  if (!id) return null;
  const row = db.prepare("SELECT id FROM servers WHERE id=? AND type='velocity'").get(id) as
    | { id: string }
    | undefined;
  return row ? id : null;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

export class ImportService {
  constructor(
    private config: AppConfig,
    private db: Db,
    private servers: ServerRepository,
    private processes: ProcessManager,
    private logs: LogStore,
  ) {}

  private async pickPort(requested?: number, propsDir?: string, prefer?: number): Promise<number> {
    if (requested !== undefined) {
      if (!validatePort(requested)) throw new Error("Port must be 1-65535");
      if (!(await isPortBlockFree(this.db, requested))) {
        throw new Error(`Port ${requested} is already in use`);
      }
      return requested;
    }
    const candidates: number[] = [];
    if (prefer !== undefined) candidates.push(prefer);
    if (propsDir) {
      const fromProps = Number(readProps(propsDir).get("server-port"));
      if (validatePort(fromProps) && !candidates.includes(fromProps)) candidates.push(fromProps);
    }
    for (const p of candidates) {
      if (await isPortBlockFree(this.db, p)) return p;
    }
    return nextFreePort(this.db, 25565);
  }

  async importPath(input: ImportPathInput): Promise<MinecraftServer> {
    const src = path.resolve(input.path);
    const dataRoot = path.resolve(this.config.dataDir);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
      throw new Error("Source path is not an existing directory");
    }
    if (src === dataRoot || src.startsWith(dataRoot + path.sep)) {
      throw new Error("Cannot import a directory inside the minecher data directory");
    }
    const jar = findJar(src);
    if (!jar) throw new Error("No .jar file found in the server directory");

    const type = input.type ?? detectType(src);
    const version = input.version?.trim() || "imported";
    const name = input.name?.trim() || path.basename(src);

    const staging = path.join(this.config.dataDir, "tmp", `import-${randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true });
    try {
      fs.cpSync(src, staging, { recursive: true, filter: (s) => shouldCopy(s) });
      const targetJar = path.join(staging, expectedJar(type));
      if (path.join(staging, jar) !== targetJar) {
        fs.copyFileSync(path.join(staging, jar), targetJar);
        fs.rmSync(path.join(staging, jar));
      }
      const port = await this.pickPort(input.port, src);
      const server = this.servers.create(
        {
          name,
          type,
          version,
          port,
          javaPath: input.javaPath ?? null,
          memoryMaxMb: input.memoryMaxMb ?? 1024,
          memoryMinMb: input.memoryMinMb ?? 1024,
        },
        undefined,
      );
      const dest = path.join(this.config.dataDir, "servers", server.id);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(staging, dest);
      this.logs.append(
        server.id,
        "system",
        `Imported server from ${src} (${(dirSize(dest) / 1024 / 1024).toFixed(1)} MB)`,
      );
      return server;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  async importMcS(archivePath: string, input: { name?: string; port?: number } = {}): Promise<MinecraftServer> {
    if (!fs.existsSync(archivePath)) throw new Error("Archive file is missing");
    const staging = path.join(this.config.dataDir, "tmp", `mcs-${randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true });
    try {
      new AdmZip(archivePath).extractAllTo(staging, true);

      const metaPath = path.join(staging, "mcs.json");
      if (!fs.existsSync(metaPath)) throw new Error("Not a minecher archive: mcs.json is missing");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as McSMetadata;
      if (meta.format !== MCS_FORMAT) throw new Error(`Unsupported archive format: ${meta.format}`);

      const port = await this.pickPort(input.port, staging, meta.port);
      const server = this.servers.create(
        {
          name: input.name?.trim() || meta.name || "Imported",
          type: meta.type ?? "custom",
          version: meta.version ?? "imported",
          port,
          javaPath: meta.javaPath ?? null,
          memoryMaxMb: meta.memoryMaxMb || 1024,
          memoryMinMb: meta.memoryMinMb || 1024,
          javaArgs: Array.isArray(meta.javaArgs) ? meta.javaArgs : [],
          serverProps: meta.serverProps && typeof meta.serverProps === "object" ? meta.serverProps : {},
          autoStart: !!meta.autoStart,
          autoRestart: meta.autoRestart !== false,
          velocityProxyId: resolveVelocityProxy(this.db, meta.velocityProxyId),
        },
        undefined,
      );
      const dest = subDir(this.config, "servers", server.id);
      fs.cpSync(staging, dest, { recursive: true, filter: (s) => shouldCopy(s) });
      this.logs.append(
        server.id,
        "system",
        `Imported from minecher archive (${(dirSize(dest) / 1024 / 1024).toFixed(1)} MB)`,
      );
      return server;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  async exportMcS(serverId: string): Promise<{ path: string; size: number }> {
    const server = this.servers.byId(serverId);
    if (!server) throw new Error("Server not found");
    if (this.processes.isRunning(serverId)) throw new Error("Stop the server before exporting");
    const srcDir = this.processes.serverDir(server);
    if (!fs.existsSync(srcDir)) throw new Error("Server directory does not exist");

    const safeName = server.name.replace(/[^\w.-]+/g, "_") || "server";
    const outDir = subDir(this.config, "export");
    const target = path.join(outDir, `${safeName}-${server.id.slice(0, 8)}.mcs`);
    fs.rmSync(target, { force: true });

    const meta: McSMetadata = {
      format: MCS_FORMAT,
      name: server.name,
      type: server.type,
      version: server.version,
      memoryMaxMb: server.memoryMaxMb,
      memoryMinMb: server.memoryMinMb,
      javaArgs: server.javaArgs,
      javaPath: server.javaPath,
      serverProps: server.serverProps,
      port: server.port,
      autoStart: server.autoStart,
      autoRestart: server.autoRestart,
      velocityProxyId: server.velocityProxyId,
      exportedAt: new Date().toISOString(),
    };

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(target);
      const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append(JSON.stringify(meta, null, 2), { name: "mcs.json" });
      archive.glob("**/*", { cwd: srcDir, dot: true, ignore: EXPORT_EXCLUDE });
      void archive.finalize();
    });

    this.logs.append(server.id, "system", `Exported .mcs archive (size=${fs.statSync(target).size})`);
    return { path: target, size: fs.statSync(target).size };
  }
}
