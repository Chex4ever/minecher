import type { FastifyInstance, FastifyRequest } from "fastify";
import { checkCredentials, createUser, listUsers, roleAtLeast } from "../services/auth.js";
import type { AppContext } from "../services/context.js";
import type { User } from "@minecher/types";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: User["role"]; username: string };
    user: User;
  }
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    if (!body?.username || !body?.password) {
      return reply.code(400).send({ error: "missing_credentials", message: "username and password required" });
    }
    const user = checkCredentials(ctx.db, body.username, body.password);
    if (!user) {
      return reply.code(401).send({ error: "invalid_credentials", message: "Invalid username or password" });
    }
    const token = app.jwt.sign({ sub: user.id, role: user.role, username: user.username });
    return { token, user };
  });

  app.get("/api/auth/me", { preHandler: [authenticate] }, async (request) => {
    return { user: request.user };
  });

  app.post(
    "/api/auth/users",
    { preHandler: [authenticate, requireRole("admin")] },
    async (request, reply) => {
      const body = request.body as { username?: string; password?: string; role?: User["role"] };
      if (!body?.username || !body?.password) {
        return reply.code(400).send({ error: "missing_fields", message: "username and password required" });
      }
      const user = createUser(ctx.db, body.username, body.password, body.role ?? "viewer");
      return { user };
    },
  );

  app.get(
    "/api/auth/users",
    { preHandler: [authenticate, requireRole("admin")] },
    async () => ({ users: listUsers(ctx.db) }),
  );
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    const err = new Error("Unauthorized") as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
}

export function requireRole(role: User["role"]) {
  return async (request: FastifyRequest) => {
    if (!request.user || !roleAtLeast(request.user, role)) {
      const err = new Error("Forbidden") as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }
  };
}
