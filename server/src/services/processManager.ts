import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { ServerStatus } from "@minecher/types";
import type { MinecraftServer } from "@minecher/types";
import type { EventBus } from "./eventBus.js";
import type { LogStore } from "./logStore.js";
import type { DownloadService } from "./download.js";
import type { ServerRepository } from "./serverRepository.js";
import type { RconClient } from "./rcon.js";
import { getSource } from "../versions/index.js";
import { subDir, type AppConfig } from "../config.js";
import { ensureBundledJava } from "./runtime.js";
import { RCON_PORT_OFFSET, QUERY_PORT_OFFSET } from "./ports.js";
import {
  ensureVelocitySecret,
  patchVelocityBackend,
  renderVelocityToml,
  sanitizeVelocityName,
} from "./velocity.js";

interface RunningServer {
  server: MinecraftServer;
  process: ChildProcess;
  status: ServerStatus;
  startedAt: number;
  lastRestartAt: number;
  restartCount: number;
  stoppingTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  statsTimer?: NodeJS.Timeout;
  lastCpuSample?: { at: number; cpuTime: number };
  playersOnline: number;
  playersMax: number;
  processBuffer?: string;
  restartsInWindow?: number;
  proxyPatched?: boolean;
}

const JOIN_RE = /: ([0-9a-f-]{32,36}) joined the game/i;
const LEAVE_RE = /: ([0-9a-f-]{32,36}) left the game/i;
const USERS_ONLINE_RE = /There are (\d+) of a max of (\d+) players online/i;
const PLAYERS_RE = /players\.online=/;

export class ProcessManager {
  private running = new Map<string, RunningServer>();

  constructor(
    private config: AppConfig,
    private db: ServerRepository,
    private logs: LogStore,
    private downloads: DownloadService,
    private events: EventBus,
    private rcon?: RconClient,
  ) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  getStatus(id: string): ServerStatus {
    return this.running.get(id)?.status ?? "stopped";
  }

  getRunning(id: string): RunningServer | undefined {
    return this.running.get(id);
  }

  serverDir(server: MinecraftServer): string {
    return subDir(this.config, "servers", server.id);
  }

  private setStatus(entry: RunningServer, status: ServerStatus): void {
    entry.status = status;
    this.db.setStatus(entry.server.id, status);
    this.events.emitServerEvent({ type: "status", serverId: entry.server.id, status });
  }

  async reconcile(): Promise<void> {
    for (const server of this.db.all()) {
      if (this.isRunning(server.id)) continue;
      if (server.status === "stopped") continue;
      const pid = server.pid;
      const probe = pid != null ? await probeProcess(pid) : "gone";
      try {
        if (probe === "java" && pid != null) {
          this.logs.append(
            server.id,
            "system",
            `Daemon restarted: terminating orphan java process ${pid} left from previous instance`,
          );
          await killOrphan(pid);
        } else {
          this.logs.append(
            server.id,
            "system",
            probe === "other"
              ? `Stale status "${server.status}" reset to stopped (pid ${pid} now belongs to another process)`
              : `Stale status "${server.status}" reset to stopped (daemon restarted, no live process)`,
          );
        }
        this.db.setPid(server.id, null);
        this.db.setStatus(server.id, "stopped", null, new Date().toISOString());
        this.events.emitServerEvent({ type: "status", serverId: server.id, status: "stopped" });
      } catch (err) {
        this.logs.append(server.id, "system", `Status reconciliation failed: ${String(err)}`);
      }
    }
  }

  async start(serverId: string): Promise<void> {
    const existing = this.running.get(serverId);
    if (existing && existing.status !== "stopped") {
      return;
    }
    const server = this.db.byId(serverId);
    if (!server) throw new Error("Server not found");

    const dir = this.serverDir(server);
    fs.mkdirSync(dir, { recursive: true });

    await this.ensureJar(server, dir);
    if (server.type === "velocity") {
      this.writeVelocityConfig(server);
    } else {
      this.writeServerProps(server, dir);
      this.configureVelocityBackend(server, dir);
    }

    const java = await this.resolveJava(server);

    const entry: RunningServer = {
      server,
      process: null as unknown as ChildProcess,
      status: "starting",
      startedAt: Date.now(),
      lastRestartAt: 0,
      restartCount: 0,
      playersOnline: 0,
      playersMax: 0,
    };
    this.running.set(serverId, entry);
    this.setStatus(entry, "starting");

    try {
      const proc = this.spawnJava(server, entry, dir, java);
      entry.process = proc;
      this.db.setPid(serverId, proc.pid ?? null);
      this.setStatus(entry, "running");
      this.startStats(entry);
    } catch (err) {
      this.running.delete(serverId);
      this.setStatus(entry, "error");
      this.logs.append(serverId, "system", `Failed to start: ${String(err)}`);
      throw err;
    }
  }

  private buildServerProps(server: MinecraftServer, dir: string): Map<string, string> {
    const target = path.join(dir, "server.properties");
    const byKey = new Map<string, string>();
    if (fs.existsSync(target)) {
      for (const line of fs.readFileSync(target, "utf8").split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0) byKey.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
      }
    }
    if (!byKey.has("online-mode")) byKey.set("online-mode", "false");
    for (const [k, v] of Object.entries(server.serverProps)) byKey.set(k, v);
    byKey.set("online-mode", server.serverProps["online-mode"] ?? "false");
    byKey.set("server-port", String(server.port));
    byKey.set("rcon.port", String(server.port + RCON_PORT_OFFSET));
    byKey.set("query.port", String(server.port + QUERY_PORT_OFFSET));
    byKey.set("motd", `\u00a7a${server.name}`);
    if (server.velocityProxyId) {
      byKey.set("server-ip", "127.0.0.1");
    }
    return byKey;
  }

  serverProps(server: MinecraftServer): Record<string, string> {
    return Object.fromEntries(this.buildServerProps(server, this.serverDir(server)));
  }

  private writeServerProps(server: MinecraftServer, dir: string): void {
    const byKey = this.buildServerProps(server, dir);
    fs.writeFileSync(
      path.join(dir, "server.properties"),
      [...byKey.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    );
    fs.writeFileSync(path.join(dir, "eula.txt"), "eula=true\n");
  }

  private writeVelocityConfig(proxy: MinecraftServer): void {
    const dir = this.serverDir(proxy);
    ensureVelocitySecret(dir);
    const backends = this.db
      .all()
      .filter((s) => s.velocityProxyId === proxy.id && s.type !== "velocity")
      .map((s) => ({
        name: sanitizeVelocityName(s.name),
        address: `127.0.0.1:${s.port}`,
      }));
    const used = new Set<string>();
    for (const b of backends) {
      let name = b.name;
      let i = 2;
      while (used.has(name)) name = `${b.name}_${i++}`;
      used.add(name);
      b.name = name;
    }
    fs.writeFileSync(
      path.join(dir, "velocity.toml"),
      renderVelocityToml({ port: proxy.port, motd: proxy.name, backends }),
    );
    this.logs.append(
      proxy.id,
      "system",
      backends.length
        ? `Velocity proxy configured with ${backends.length} backend(s)`
        : "Velocity proxy started with no backends",
    );
  }

  private configureVelocityBackend(server: MinecraftServer, dir: string): void {
    if (!server.velocityProxyId) return;
    const proxy = this.db.byId(server.velocityProxyId);
    if (!proxy || proxy.type !== "velocity") {
      throw new Error(
        `Velocity proxy "${server.velocityProxyId}" not found; remove the proxy assignment in Settings`,
      );
    }
    const secret = ensureVelocitySecret(this.serverDir(proxy));
    patchVelocityBackend(dir, secret);
    this.logs.append(
      server.id,
      "system",
      `Configured as backend of Velocity "${proxy.name}" (expose only port ${proxy.port})`,
    );
  }

  private patchPaperAfterBoot(server: MinecraftServer): void {
    try {
      if (!server.velocityProxyId) return;
      const proxy = this.db.byId(server.velocityProxyId);
      if (!proxy || proxy.type !== "velocity") return;
      const dir = this.serverDir(server);
      const secret = ensureVelocitySecret(this.serverDir(proxy));
      patchVelocityBackend(dir, secret);
      this.logs.append(
        server.id,
        "system",
        "Patched paper config for Velocity modern forwarding (takes effect on next start)",
      );
    } catch (err) {
      this.logs.append(
        server.id,
        "system",
        `Failed to patch paper config for Velocity: ${String(err)}`,
      );
    }
  }

  velocityToml(server: MinecraftServer): string | null {
    if (server.type !== "velocity") return null;
    const file = path.join(this.serverDir(server), "velocity.toml");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  private async ensureJar(server: MinecraftServer, dir: string): Promise<void> {
    if (server.type === "custom") {
      const jarPath = path.join(dir, this.jarFileName(server));
      if (!fs.existsSync(jarPath)) {
        throw new Error("server.jar is missing in the imported server directory");
      }
      return;
    }
    const jarName = this.jarFileName(server);
    const jarPath = path.join(dir, jarName);
    if (fs.existsSync(jarPath) && fs.statSync(jarPath).size > 0) {
      return;
    }
    this.logs.append(server.id, "system", `Downloading ${server.type} ${server.version}...`);
    const loaderVersion = server.jarPath && server.jarPath.includes("-")
      ? server.jarPath.split("-").slice(1).join("-")
      : undefined;
    const resolved = await this.downloads.resolve(server.type, server.version, loaderVersion);
    const cached = await this.downloads.ensureJar(resolved);
    fs.copyFileSync(cached, jarPath);

    if (server.type === "forge") {
      this.logs.append(server.id, "system", "Running Forge installer (--installServer)...");
      await this.runForgeInstaller(server, dir, jarName);
    }
  }

  private jarFileName(server: MinecraftServer): string {
    switch (server.type) {
      case "forge":
        return "server.jar";
      case "fabric":
        return "fabric-server.jar";
      default:
        return "server.jar";
    }
  }

  private async resolveJava(server: MinecraftServer): Promise<string> {
    if (server.javaPath) return server.javaPath;
    try {
      return await ensureBundledJava(this.config, (msg) =>
        this.logs.append(server.id, "system", msg),
      );
    } catch (err) {
      this.logs.append(
        server.id,
        "system",
        `Bundled Java unavailable (${String(err)}); falling back to system java`,
      );
      return process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
        : "java";
    }
  }

  private spawnJava(server: MinecraftServer, entry: RunningServer, dir: string, java: string): ChildProcess {
    const jarName = this.jarFileName(server);
    const args = [
      `-Xms${server.memoryMinMb}M`,
      `-Xmx${server.memoryMaxMb}M`,
      ...server.javaArgs,
      "-jar",
      jarName,
      ...(server.type === "velocity" ? [] : ["nogui"]),
    ];
    this.logs.append(server.id, "system", `Starting: ${java} ${args.join(" ")}`);

    const proc = spawn(java, args, {
      cwd: dir,
      env: { ...process.env, JAVA_HOME: server.javaPath ?? process.env.JAVA_HOME ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    proc.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.handleOutput(entry, "stdout", chunk);
    });
    proc.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      this.handleOutput(entry, "stderr", chunk);
    });
    proc.on("exit", (code, signal) => this.onExit(entry, code, signal));
    proc.on("error", (err) => {
      this.logs.append(server.id, "system", `Process error: ${err.message}`);
    });
    return proc;
  }

  private handleOutput(entry: RunningServer, stream: "stdout" | "stderr", chunk: string): void {
    let buffer = entry.processBuffer ?? "";
    buffer += chunk;
    entry.processBuffer = buffer;
    const lines = buffer.split(/\r?\n/);
    entry.processBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) this.logs.append(entry.server.id, stream, line);
      if (
        entry.server.velocityProxyId &&
        !entry.proxyPatched &&
        /Done \(/.test(line)
      ) {
        entry.proxyPatched = true;
        this.patchPaperAfterBoot(entry.server);
      }
      this.parsePlayers(entry, line);
    }
  }

  private parsePlayers(entry: RunningServer, line: string): void {
    const join = line.match(JOIN_RE);
    const leave = line.match(LEAVE_RE);
    if (join) entry.playersOnline += 1;
    if (leave) entry.playersOnline = Math.max(0, entry.playersOnline - 1);
    const online = line.match(USERS_ONLINE_RE);
    if (online) {
      entry.playersOnline = Number(online[1]);
      entry.playersMax = Number(online[2]);
    }
    if (PLAYERS_RE.test(line)) {
      const m = line.match(/players\.online=(\d+)/);
      if (m) entry.playersOnline = Number(m[1]);
    }
  }

  private startStats(entry: RunningServer): void {
    entry.statsTimer = setInterval(() => this.collectStats(entry), 2000);
    entry.statsTimer.unref?.();
  }

  private async collectStats(entry: RunningServer): Promise<void> {
    const pid = entry.process.pid;
    if (!pid) return;
    const usage = await getProcessUsage(pid);
    let cpuPercent = 0;
    if (usage) {
      const now = Date.now();
      if (entry.lastCpuSample) {
        const dt = now - entry.lastCpuSample.at;
        const dCPU = usage.cpuMs - entry.lastCpuSample.cpuTime;
        cpuPercent = dt > 0 ? (dCPU / dt) * 100 : 0;
      }
      entry.lastCpuSample = { at: now, cpuTime: usage.cpuMs };
    }
    this.events.emitServerEvent({
      type: "stats",
      serverId: entry.server.id,
      stats: {
        uptimeMs: Date.now() - entry.startedAt,
        memoryUsedMb: usage?.memMb ?? 0,
        memoryMaxMb: entry.server.memoryMaxMb,
        cpuPercent,
        tps: null,
        playersOnline: entry.playersOnline,
        playersMax: entry.playersMax,
      },
    });
  }

  async stop(serverId: string, opts: { force?: boolean; command?: string } = {}): Promise<void> {
    const entry = this.running.get(serverId);
    if (!entry) return;
    if (entry.status === "stopping" && !opts.force) return;

    if (opts.force || !entry.process.stdin?.writable) {
      await this.kill(entry);
      return;
    }

    this.setStatus(entry, "stopping");
    const cmd = opts.command ?? "stop";
    entry.process.stdin.write(`${cmd}\n`);

    entry.stoppingTimer = setTimeout(async () => {
      if (this.running.has(serverId)) {
        this.logs.append(serverId, "system", "Graceful stop timed out, killing process");
        await this.kill(entry);
      }
    }, 15_000);
    entry.stoppingTimer.unref?.();
  }

  private async kill(entry: RunningServer): Promise<void> {
    clearTimeout(entry.stoppingTimer);
    clearTimeout(entry.killTimer);
    const pid = entry.process.pid;
    if (pid) {
      try {
        entry.process.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      entry.killTimer = setTimeout(() => {
        try {
          entry.process.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 3000);
      entry.killTimer.unref?.();
    }
  }

  private onExit(entry: RunningServer, code: number | null, signal: string | null): void {
    const id = entry.server.id;
    clearTimeout(entry.stoppingTimer);
    clearTimeout(entry.killTimer);
    clearInterval(entry.statsTimer);

    const wasStopping = entry.status === "stopping";
    this.running.delete(id);
    this.db.setPid(id, null);
    this.db.setStatus(id, wasStopping ? "stopped" : "stopped", undefined, new Date().toISOString());
    this.logs.append(
      id,
      "system",
      `Process exited (code=${code}, signal=${signal ?? "none"})`,
    );

    const server = this.db.byId(id);
    if (!server) return;

    if (!wasStopping && server.autoRestart) {
      const now = Date.now();
      entry.restartCount += 1;
      this.db.setRestartsCount(id, entry.restartCount);
      if (now - entry.lastRestartAt < 60_000) {
        entry.restartsInWindow ??= 0;
        entry.restartsInWindow += 1;
      } else {
        entry.restartsInWindow = 1;
      }
      entry.lastRestartAt = now;

      if (entry.restartsInWindow > 3) {
        this.db.setStatus(id, "crash-loop");
        this.logs.append(id, "system", "Crash-loop detected, giving up auto-restart");
        this.events.emitServerEvent({ type: "status", serverId: id, status: "crash-loop" });
        return;
      }
      this.logs.append(id, "system", "Auto-restarting in 5s...");
      const timer = setTimeout(() => {
        void this.start(id).catch((err) =>
          this.logs.append(id, "system", `Auto-restart failed: ${String(err)}`),
        );
      }, 5000);
      timer.unref?.();
    }
    this.events.emitServerEvent({ type: "status", serverId: id, status: "stopped" });
  }

  sendCommand(serverId: string, command: string): void {
    const entry = this.running.get(serverId);
    if (entry?.process.stdin?.writable) {
      entry.process.stdin.write(`${command}\n`);
      this.logs.append(serverId, "stdout", `> ${command}`);
      return;
    }
    if (this.rcon) {
      this.logs.append(serverId, "system", `Sending via RCON: ${command}`);
      void this.rcon.send(serverId, command).then((res) => {
        if (!res.ok) {
          this.logs.append(serverId, "system", `RCON failed: ${res.error ?? "unknown error"}`);
        } else if (res.body?.trim()) {
          this.logs.append(serverId, "stdout", res.body);
        }
      });
      return;
    }
    throw new Error("Server is not running");
  }

  private async runForgeInstaller(server: MinecraftServer, dir: string, jarName: string): Promise<void> {
    const java = await this.resolveJava(server);
    const installer = jarName;
    const proc = spawn(java, ["-jar", installer, "--installServer"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      this.logs.append(server.id, "stdout", d.toString().trim());
    });
    proc.stderr?.on("data", (d: Buffer) => {
      this.logs.append(server.id, "stderr", d.toString().trim());
    });
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));
    if (!out.includes("Successfully installed") && !fs.existsSync(path.join(dir, "libraries"))) {
      this.logs.append(server.id, "system", "Forge installer finished (check logs)");
    }
  }

  async stopAll(): Promise<void> {
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.stop(id, { command: "stop" })));
    await new Promise((r) => setTimeout(r, 1000));
    for (const entry of this.running.values()) {
      await this.kill(entry);
    }
  }
}

interface ProcessUsage {
  memMb: number;
  cpuMs: number;
}

async function probeProcess(pid: number): Promise<"java" | "other" | "gone"> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const child = spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName }`,
        ],
        { windowsHide: true },
      );
      let out = "";
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.on("exit", () => {
        const name = out.trim().toLowerCase();
        if (!name) resolve("gone");
        else resolve(name.includes("java") ? "java" : "other");
      });
      child.on("error", () => resolve("gone"));
    });
  }
  try {
    await fs.promises.access(`/proc/${pid}`);
    const comm = (await fs.promises.readFile(`/proc/${pid}/comm`, "utf8")).trim().toLowerCase();
    return comm.includes("java") ? "java" : "other";
  } catch {
    return "gone";
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killOrphan(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* ignore */
  }
}

async function getProcessUsage(pid: number): Promise<ProcessUsage | null> {
  if (process.platform === "win32") {
    return getWindowsUsage(pid);
  }
  try {
    const stat = await fs.promises.readFile(`/proc/${pid}/stat`, "utf8");
    const m = stat.match(/\)\s+(.{5,})\s+/);
    const parts = stat.split(" ");
    const utime = Number(parts[13]);
    const stime = Number(parts[14]);
    const cpuMs = (utime + stime) * 10;
    const status = await fs.promises.readFile(`/proc/${pid}/status`, "utf8");
    const vmRSS = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return { memMb: vmRSS ? Math.round(Number(vmRSS[1]) / 1024) : 0, cpuMs };
  } catch {
    return null;
  }
}

async function getWindowsUsage(pid: number): Promise<ProcessUsage | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [PSCustomObject]@{ Mem = [math]::Round($p.WorkingSet64 / 1MB, 1); Cpu = [math]::Round($p.CPU * 1000) } | ConvertTo-Json }`,
      ],
      { windowsHide: true },
    );
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("exit", () => {
      try {
        const parsed = JSON.parse(out.trim()) as { Mem?: number; Cpu?: number };
        if (parsed && parsed.Mem !== undefined) {
          resolve({ memMb: parsed.Mem, cpuMs: parsed.Cpu ?? 0 });
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}
