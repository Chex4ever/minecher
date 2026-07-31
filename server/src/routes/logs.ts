import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import type { FastifyRequest } from "fastify";
import { authenticate } from "./auth.js";

export function logRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    "/api/servers/:id/logs",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const server = ctx.servers.byId(id);
      if (!server) return reply.code(404).send({ error: "not_found", message: "Server not found" });
      const query = request.query as { offset?: string; limit?: string; q?: string; stream?: string; level?: string };
      const entries = ctx.logs.query(id, {
        offset: query.offset ? Number(query.offset) : 0,
        limit: query.limit ? Number(query.limit) : 200,
        q: query.q,
        stream: query.stream,
        level: query.level,
      });
      return { entries };
    },
  );
}

export function consoleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/servers/:id/console", { websocket: true }, async (socket, request: FastifyRequest) => {
    try {
      const auth = request.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        await request.jwtVerify();
      } else {
        const token = (request.query as { token?: string }).token;
        if (!token) throw new Error("no token");
        request.user = app.jwt.verify(token) as never;
      }
    } catch {
      socket.close(4401, "Unauthorized");
      return;
    }
    const role = request.user?.role ?? "viewer";
    const id = (request.params as { id: string }).id;
    const server = ctx.servers.byId(id);
    if (!server) {
      socket.close();
      return;
    }

      socket.send(
        JSON.stringify({
          type: "tail",
          entries: ctx.logs.query(id, { limit: 100 }),
        }),
      );

      const unsubscribe = ctx.events.onServerEvent((event) => {
        if (event.type === "log" && event.serverId === id) {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "log", entry: event }));
          }
        }
        if (event.type === "status" && event.serverId === id && socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "status", status: event.status }));
        }
      });

      socket.on("message", (raw: Buffer) => {
        if (socket.readyState !== socket.OPEN) return;
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string; command?: string };
          if (msg.type === "command" && typeof msg.command === "string") {
            if (role !== "admin" && role !== "operator") {
              socket.send(JSON.stringify({ type: "error", message: "Forbidden" }));
              return;
            }
            ctx.processes.sendCommand(id, msg.command);
          }
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        }
      });

      socket.on("close", unsubscribe);
      socket.on("error", unsubscribe);
    },
  );
}
