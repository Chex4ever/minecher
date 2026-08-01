import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import dns from "node:dns";
import { resolveDataDir } from "./config.js";
import { openDb } from "./db.js";
import { createEventBus } from "./services/eventBus.js";
import { LogStore } from "./services/logStore.js";
import { DownloadService } from "./services/download.js";
import { ServerRepository } from "./services/serverRepository.js";
import { ProcessManager } from "./services/processManager.js";
import { BackupService } from "./services/backups.js";
import { ImportService } from "./services/imports.js";
import { RconClient } from "./services/rcon.js";
import { SchedulerService } from "./services/scheduler.js";
import type { AppContext } from "./services/context.js";
import { createUser } from "./services/auth.js";
import { authRoutes } from "./routes/auth.js";
import { serverRoutes } from "./routes/servers.js";
import { logRoutes, consoleRoutes } from "./routes/logs.js";
import { versionRoutes } from "./routes/versions.js";
import { backupRoutes } from "./routes/backups.js";
import { importRoutes } from "./routes/imports.js";
import { scheduleRoutes, rconRoutes } from "./routes/schedules.js";
import { portRoutes } from "./routes/ports.js";

async function main(): Promise<void> {
  dns.setDefaultResultOrder("ipv4first");
  const config = resolveDataDir();
  const db = openDb(config);
  const events = createEventBus();
  const logs = new LogStore(config, db, events);
  const downloads = new DownloadService(config);
  const servers = new ServerRepository(db);
  const rcon = new RconClient(config, servers, logs);
  const processes = new ProcessManager(config, servers, logs, downloads, events, rcon);
  const backups = new BackupService(config, db, servers, processes, logs);
  const imports = new ImportService(config, db, servers, processes, logs);
  const scheduler = new SchedulerService(db, logs);

  const ctx: AppContext = {
    config,
    db,
    events,
    logs,
    downloads,
    servers,
    processes,
    backups,
    imports,
    rcon,
    scheduler,
  };
  scheduler.ctx = ctx;

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(jwt, {
    secret: config.authSecret,
    sign: { expiresIn: config.jwtExpiresIn },
  });
  await app.register(websocket);
  await app.register(multipart, { limits: { files: 1, fileSize: 4 * 1024 * 1024 * 1024 } });

  app.addContentTypeParser("application/json", (request, payload, done) => {
    let data = "";
    payload.on("data", (chunk: Buffer) => (data += chunk.toString()));
    payload.on("end", () => {
      if (data.trim() === "") return done(null, {});
      try {
        done(null, JSON.parse(data));
      } catch (err) {
        done(err as Error);
      }
    });
    payload.on("error", (err) => done(err));
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", (request, payload, done) => {
    let data = "";
    payload.on("data", (chunk: Buffer) => (data += chunk.toString()));
    payload.on("end", () => done(null, data ? Object.fromEntries(new URLSearchParams(data)) : {}));
    payload.on("error", (err) => done(err));
  });

  app.get("/api/health", async () => ({ ok: true, uptime: process.uptime() }));

  authRoutes(app, ctx);
  serverRoutes(app, ctx);
  logRoutes(app, ctx);
  consoleRoutes(app, ctx);
  versionRoutes(app, ctx);
  backupRoutes(app, ctx);
  importRoutes(app, ctx);
  scheduleRoutes(app, ctx);
  rconRoutes(app, ctx);
  portRoutes(app, ctx);

  bootstrapAdmin(config, db);

  app.addHook("onClose", async () => {
    scheduler.stop();
    await processes.stopAll();
    logs.close();
    db.close();
  });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });

  scheduler.start();
  await processes.reconcile();
  autoStartAll(ctx);
}

function bootstrapAdmin(config: { dataDir: string; authSecret: string }, db: ReturnType<typeof openDb>): void {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (users.n === 0) {
    const username = process.env.MC_ADMIN_USERNAME ?? "admin";
    const password = process.env.MC_ADMIN_PASSWORD ?? "admin";
    createUser(db, username, password, "admin");
    if (!process.env.MC_ADMIN_PASSWORD) {
      console.warn(
        "[minecher] Created default admin account admin/admin. Set MC_ADMIN_PASSWORD to override (and change it now!).",
      );
    }
  }
}

function autoStartAll(ctx: AppContext): void {
  for (const server of ctx.servers.all()) {
    if (server.autoStart && server.status !== "running") {
      ctx.processes.start(server.id).catch((err) =>
        ctx.logs.append(server.id, "system", `Auto-start failed: ${String(err)}`),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

