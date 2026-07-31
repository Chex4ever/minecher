import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../services/context.js";
import type { ServerCreateInput, ServerUpdateInput } from "../services/serverRepository.js";
import { nextFreePort, isPortFree, validatePort } from "../services/ports.js";
import { authenticate, requireRole } from "./auth.js";

export function serverRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/servers", { preHandler: [authenticate] }, async () => {
    return {
      servers: ctx.servers.all().map((s) => ({
        ...s,
        status: ctx.processes.isRunning(s.id) ? ctx.processes.getStatus(s.id) : s.status,
      })),
    };
  });

  app.get("/api/servers/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const server = ctx.servers.byId((request.params as { id: string }).id);
    if (!server) return reply.code(404).send({ error: "not_found", message: "Server not found" });
    return { server: { ...server, serverPropsFile: ctx.processes.serverProps(server) } };
  });

  app.post(
    "/api/servers",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const body = request.body as ServerCreateInput & { loaderVersion?: string };
      if (!body?.name || !body?.type || !body?.version) {
        return reply.code(400).send({ error: "missing_fields", message: "name, type, version required" });
      }
      let port = body.port;
      if (port !== undefined) {
        if (!validatePort(port)) {
          return reply.code(400).send({ error: "bad_port", message: "Port must be 1-65535" });
        }
        if (!(await isPortFree(port))) {
          return reply.code(409).send({
            error: "port_busy",
            message: `Port ${port} is already in use`,
          });
        }
      } else {
        try {
          port = await nextFreePort(ctx.db, 25565);
        } catch (err) {
          return reply.code(409).send({ error: "no_free_port", message: String(err) });
        }
      }
      const server = ctx.servers.create({ ...body, port }, body.loaderVersion);
      ctx.events.emitServerEvent({ type: "created", server });
      return reply.code(201).send({ server });
    },
  );

  app.patch(
    "/api/servers/:id",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const body = request.body as ServerUpdateInput;
      const server = ctx.servers.update((request.params as { id: string }).id, body);
      if (!server) return reply.code(404).send({ error: "not_found", message: "Server not found" });
      ctx.events.emitServerEvent({ type: "updated", server });
      return { server };
    },
  );

  app.delete(
    "/api/servers/:id",
    { preHandler: [authenticate, requireRole("admin")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const server = ctx.servers.byId(id);
      if (!server) return reply.code(404).send({ error: "not_found", message: "Server not found" });
      if (ctx.processes.isRunning(id)) {
        await ctx.processes.stop(id, { force: true });
      }
      ctx.servers.delete(id);
      ctx.events.emitServerEvent({ type: "deleted", serverId: id });
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/servers/:id/start",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      try {
        await ctx.processes.start((request.params as { id: string }).id);
        return { ok: true };
      } catch (err) {
        return reply.code(500).send({ error: "start_failed", message: String(err) });
      }
    },
  );

  app.post(
    "/api/servers/:id/stop",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { force?: boolean } | undefined;
      await ctx.processes.stop(id, { force: body?.force });
      return { ok: true };
    },
  );

  app.post(
    "/api/servers/:id/restart",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      await ctx.processes.stop(id);
      await new Promise((r) => setTimeout(r, 800));
      await ctx.processes.start(id);
      return { ok: true };
    },
  );

  app.post(
    "/api/servers/:id/command",
    { preHandler: [authenticate, requireRole("operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { command?: string };
      if (!body?.command) {
        return reply.code(400).send({ error: "missing_command", message: "command required" });
      }
      try {
        ctx.processes.sendCommand(id, body.command);
        return { ok: true };
      } catch (err) {
        return reply.code(409).send({ error: "not_running", message: String(err) });
      }
    },
  );
}
