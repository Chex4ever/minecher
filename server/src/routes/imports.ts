import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { AppContext } from "../services/context.js";
import type { ImportPathInput } from "../services/imports.js";
import { authenticate, requireRole } from "./auth.js";

export function importRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    "/api/imports/path",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const body = (request.body ?? {}) as ImportPathInput;
      if (!body.path || typeof body.path !== "string" || body.path.trim() === "") {
        return reply.code(400).send({ error: "missing_path", message: "path required" });
      }
      try {
        const server = await ctx.imports.importPath(body);
        ctx.events.emitServerEvent({ type: "created", server });
        return reply.code(201).send({ server });
      } catch (err) {
        return reply.code(400).send({ error: "import_failed", message: String(err) });
      }
    },
  );

  app.post(
    "/api/imports/mcs",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      let upload;
      try {
        upload = await request.file();
      } catch {
        upload = null;
      }
      if (!upload) {
        return reply.code(400).send({ error: "missing_file", message: "file field required" });
      }
      const tmp = path.join(ctx.config.dataDir, "tmp", `upload-${randomUUID()}.mcs`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      try {
        await pipeline(upload.file, fs.createWriteStream(tmp));
        const fields = upload.fields as Record<string, { value: string }> | undefined;
        const name = fields?.name?.value;
        const portText = fields?.port?.value;
        const server = await ctx.imports.importMcS(tmp, {
          name,
          port: portText ? Number(portText) : undefined,
        });
        ctx.events.emitServerEvent({ type: "created", server });
        return reply.code(201).send({ server });
      } catch (err) {
        return reply.code(400).send({ error: "import_failed", message: String(err) });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    },
  );

  app.get(
    "/api/servers/:id/export",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      try {
        const { path: file, size } = await ctx.imports.exportMcS(id);
        reply.header("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Length", String(size));
        const stream = fs.createReadStream(file);
        stream.on("close", () => fs.rmSync(file, { force: true }));
        return stream;
      } catch (err) {
        return reply.code(400).send({ error: "export_failed", message: String(err) });
      }
    },
  );
}
