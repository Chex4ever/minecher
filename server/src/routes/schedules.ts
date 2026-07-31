import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import type { ScheduleInfo } from "@minecher/types";
import { authenticate, requireRole } from "./auth.js";

export function scheduleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    "/api/servers/:id/schedules",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!ctx.servers.byId(id)) {
        return reply.code(404).send({ error: "not_found", message: "Server not found" });
      }
      return { schedules: ctx.scheduler.list(id) };
    },
  );

  app.post(
    "/api/servers/:id/schedules",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as {
        cron?: string;
        action?: ScheduleInfo["action"];
        command?: string;
        enabled?: boolean;
      };
      if (!body?.cron || !body?.action) {
        return reply.code(400).send({ error: "missing_fields", message: "cron and action required" });
      }
      if (!["start", "stop", "restart", "backup", "command"].includes(body.action)) {
        return reply.code(400).send({ error: "bad_action", message: `Unknown action: ${body.action}` });
      }
      try {
        const schedule = ctx.scheduler.create({
          serverId: id,
          cron: body.cron,
          action: body.action,
          command: body.command,
          enabled: body.enabled,
        });
        return reply.code(201).send({ schedule });
      } catch (err) {
        return reply.code(400).send({ error: "bad_cron", message: String(err) });
      }
    },
  );

  app.patch(
    "/api/servers/:id/schedules/:scheduleId",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const { scheduleId } = request.params as { scheduleId: string };
      const body = request.body as {
        cron?: string;
        action?: string;
        command?: string | null;
        enabled?: boolean;
      };
      try {
        const schedule = ctx.scheduler.update(scheduleId, body);
        if (!schedule) return reply.code(404).send({ error: "not_found", message: "Schedule not found" });
        return { schedule };
      } catch (err) {
        return reply.code(400).send({ error: "bad_cron", message: String(err) });
      }
    },
  );

  app.delete(
    "/api/servers/:id/schedules/:scheduleId",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const { scheduleId } = request.params as { scheduleId: string };
      ctx.scheduler.delete(scheduleId);
      return reply.code(204).send();
    },
  );
}

export function rconRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    "/api/servers/:id/rcon",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { command?: string };
      if (!body?.command) {
        return reply.code(400).send({ error: "missing_command", message: "command required" });
      }
      const res = await ctx.rcon.send(id, body.command);
      if (!res.ok) {
        return reply.code(409).send({ error: "rcon_failed", message: res.error });
      }
      return { ok: true, response: res.body };
    },
  );
}
