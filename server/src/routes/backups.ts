import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import { authenticate, requireRole } from "./auth.js";

export function backupRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    "/api/servers/:id/backups",
    { preHandler: [authenticate, requireRole("viewer")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!ctx.servers.byId(id)) {
        return reply.code(404).send({ error: "not_found", message: "Server not found" });
      }
      return { backups: ctx.backups.list(id) };
    },
  );

  app.post(
    "/api/servers/:id/backups",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      try {
        const backup = await ctx.backups.create(id);
        return reply.code(201).send({ backup });
      } catch (err) {
        return reply.code(500).send({ error: "backup_failed", message: String(err) });
      }
    },
  );

  app.post(
    "/api/servers/:id/backups/:backupId/restore",
    { preHandler: [authenticate, requireRole("admin")] },
    async (request, reply) => {
      const { id, backupId } = request.params as { id: string; backupId: string };
      try {
        await ctx.backups.restore(id, backupId);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: "restore_failed", message: String(err) });
      }
    },
  );

  app.delete(
    "/api/servers/:id/backups/:backupId",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const { backupId } = request.params as { backupId: string };
      ctx.backups.delete(backupId);
      return reply.code(204).send();
    },
  );
}
