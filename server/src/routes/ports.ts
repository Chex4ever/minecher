import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import { isPortBlockFree, serverBlock, validatePort } from "../services/ports.js";
import { authenticate } from "./auth.js";

export function portRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/ports/:port", { preHandler: [authenticate] }, async (request, reply) => {
    const port = Number((request.params as { port: string }).port);
    if (!validatePort(port)) {
      return reply.code(400).send({ error: "bad_port", message: "Port must be 1-65535" });
    }
    const exclude = (request.query as { exclude?: string }).exclude;
    const usedBy = ctx.servers
      .all()
      .find((s) => s.id !== exclude && serverBlock(s.port).includes(port))?.name ?? null;
    const available = !usedBy && (await isPortBlockFree(ctx.db, port, exclude));
    return { port, available, usedBy };
  });
}
