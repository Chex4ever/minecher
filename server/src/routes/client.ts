import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../services/context.js";
import { authenticate, requireRole } from "./auth.js";
import type { ClientLauncherType } from "@minecher/types";

const LAUNCHER_TYPES: ClientLauncherType[] = ["vanilla", "forge", "fabric"];

function isLauncherType(value: unknown): value is ClientLauncherType {
  return typeof value === "string" && (LAUNCHER_TYPES as string[]).includes(value);
}

export function clientRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    "/api/launcher/versions",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const type = (request.query as { type?: string }).type;
      if (!type || !isLauncherType(type)) {
        return reply.code(400).send({ error: "bad_type", message: "type must be vanilla, forge or fabric" });
      }
      try {
        return { type, versions: await ctx.clients.listVersions(type) };
      } catch (err) {
        return reply.code(502).send({ error: "version_source_error", message: String(err) });
      }
    },
  );

  app.get(
    "/api/launcher/versions/:type/:mc/loaders",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { type, mc } = request.params as { type: string; mc: string };
      if (!isLauncherType(type)) {
        return reply.code(400).send({ error: "bad_type", message: "type must be vanilla, forge or fabric" });
      }
      try {
        return { type, mcVersion: mc, loaders: await ctx.clients.listLoaders(type, mc) };
      } catch (err) {
        return reply.code(502).send({ error: "version_source_error", message: String(err) });
      }
    },
  );

  app.post(
    "/api/launcher/builds",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        launcherType?: string;
        mcVersion?: string;
        loaderVersion?: string;
        username?: string;
      };
      if (!body.launcherType || !isLauncherType(body.launcherType)) {
        return reply.code(400).send({ error: "bad_type", message: "launcherType must be vanilla, forge or fabric" });
      }
      if (!body.mcVersion || typeof body.mcVersion !== "string") {
        return reply.code(400).send({ error: "bad_version", message: "mcVersion required" });
      }
      if (!body.username || typeof body.username !== "string") {
        return reply.code(400).send({ error: "bad_username", message: "username required" });
      }
      try {
        const build = ctx.clients.createBuild({
          launcherType: body.launcherType,
          mcVersion: body.mcVersion,
          loaderVersion: body.loaderVersion,
          username: body.username,
        });
        return reply.code(201).send({ build });
      } catch (err) {
        return reply.code(400).send({ error: "bad_input", message: String(err) });
      }
    },
  );

  app.get(
    "/api/launcher/builds",
    { preHandler: [authenticate] },
    async () => ({ builds: ctx.clients.listBuilds() }),
  );

  app.get(
    "/api/launcher/builds/:id",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const build = ctx.clients.getBuild(id);
      if (!build) return reply.code(404).send({ error: "not_found", message: "Build not found" });
      return { build };
    },
  );

  app.get(
    "/api/launcher/builds/:id/download",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const build = ctx.clients.getBuild(id);
      if (!build) return reply.code(404).send({ error: "not_found", message: "Build not found" });
      if (build.status !== "done" || !build.zipPath || !fs.existsSync(build.zipPath)) {
        return reply.code(409).send({ error: "not_ready", message: "Build is not ready to download" });
      }
      const file = build.zipPath;
      reply.header("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Length", String(build.sizeBytes ?? fs.statSync(file).size));
      return fs.createReadStream(file);
    },
  );

  app.delete(
    "/api/launcher/builds/:id",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!ctx.clients.deleteBuild(id)) {
        return reply.code(404).send({ error: "not_found", message: "Build not found" });
      }
      return reply.code(204).send();
    },
  );
}
