import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import { isPortFree, validatePort } from "../services/ports.js";
import { authenticate } from "./auth.js";

export function portRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/ports/:port", { preHandler: [authenticate] }, async (request, reply) => {
    const port = Number((request.params as { port: string }).port);
    if (!validatePort(port)) {
      return reply.code(400).send({ error: "bad_port", message: "Port must be 1-65535" });
    }
    const usedBy = ctx.servers
      .all()
      .find((s) => s.port === port && ctx.processes.isRunning(s.id));
    const available = (await isPortFree(port)) && !usedBy;
    return { port, available, usedBy: usedBy?.name ?? null };
  });
}
