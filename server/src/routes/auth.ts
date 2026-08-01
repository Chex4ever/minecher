import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  changePassword,
  checkCredentials,
  createUser,
  listUsers,
  roleAtLeast,
  updateUserProfile,
  userById,
} from "../services/auth.js";
import { subDir } from "../config.js";
import type { AppContext } from "../services/context.js";
import type { User } from "@minecher/types";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: User["role"]; username: string };
    user: User;
  }
}

const AVATAR_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_URL_RE = /^[a-zA-Z0-9-]+\.(png|jpg|jpeg|gif|webp)$/;

function currentUserId(request: FastifyRequest): string {
  const sub = (request.user as unknown as { sub?: string }).sub;
  return sub ?? request.user.id;
}

function avatarMime(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function removeUserAvatarFiles(ctx: AppContext, userId: string): void {
  const dir = subDir(ctx.config, "avatars");
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(`${userId}.`)) {
      try {
        fs.unlinkSync(path.join(dir, entry));
      } catch {
        // ignore
      }
    }
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

  app.get("/api/auth/me", { preHandler: [authenticate] }, async (request, reply) => {
    const user = userById(ctx.db, currentUserId(request));
    if (!user) return reply.code(404).send({ error: "not_found", message: "User not found" });
    return { user };
  });

  app.patch("/api/auth/me", { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { username?: unknown; email?: unknown };
    const patch: { username?: string; email?: string | null } = {};
    if (body.username !== undefined) {
      if (typeof body.username !== "string" || body.username.trim() === "") {
        return reply.code(400).send({ error: "invalid_username", message: "Username cannot be empty" });
      }
      if (body.username.trim().length > 32) {
        return reply.code(400).send({ error: "invalid_username", message: "Username must be at most 32 characters" });
      }
      patch.username = body.username.trim();
    }
    if (body.email !== undefined) {
      if (body.email === null || body.email === "") {
        patch.email = null;
      } else if (typeof body.email === "string") {
        const email = body.email.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return reply.code(400).send({ error: "invalid_email", message: "Invalid email" });
        }
        patch.email = email || null;
      } else {
        return reply.code(400).send({ error: "invalid_email", message: "Invalid email" });
      }
    }
    try {
      const user = updateUserProfile(ctx.db, currentUserId(request), patch);
      if (!user) return reply.code(404).send({ error: "not_found", message: "User not found" });
      const token =
        patch.username !== undefined
          ? app.jwt.sign({ sub: user.id, role: user.role, username: user.username })
          : undefined;
      return token ? { user, token } : { user };
    } catch (err) {
      return reply.code(409).send({ error: "username_taken", message: (err as Error).message });
    }
  });

  app.post("/api/auth/me/password", { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== "string" || body.currentPassword === "") {
      return reply.code(400).send({ error: "missing_password", message: "Current password required" });
    }
    if (typeof body.newPassword !== "string" || body.newPassword.length < 6) {
      return reply.code(400).send({ error: "weak_password", message: "New password must be at least 6 characters" });
    }
    if (body.newPassword === body.currentPassword) {
      return reply.code(400).send({ error: "same_password", message: "New password must differ from the current one" });
    }
    try {
      const user = changePassword(ctx.db, currentUserId(request), body.currentPassword, body.newPassword);
      if (!user) return reply.code(404).send({ error: "not_found", message: "User not found" });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: "wrong_password", message: (err as Error).message });
    }
  });

  app.post("/api/auth/me/avatar", { preHandler: [authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "no_file", message: "No file uploaded" });
    }
    const ext = (data.filename.split(".").pop() ?? "").toLowerCase();
    if (!AVATAR_EXT.has(ext)) {
      await data.toBuffer().catch(() => undefined);
      return reply.code(400).send({ error: "invalid_type", message: "Supported formats: png, jpg, jpeg, gif, webp" });
    }
    const buffer = await data.toBuffer().catch(() => null);
    if (!buffer || buffer.byteLength === 0) {
      return reply.code(400).send({ error: "invalid_file", message: "Empty file" });
    }
    if (buffer.byteLength > AVATAR_MAX_BYTES) {
      return reply.code(400).send({ error: "too_large", message: "Avatar must be 2 MB or smaller" });
    }
    const userId = currentUserId(request);
    removeUserAvatarFiles(ctx, userId);
    await fs.promises.writeFile(path.join(subDir(ctx.config, "avatars"), `${userId}.${ext}`), buffer);
    const user = updateUserProfile(ctx.db, userId, { avatar: `/api/auth/avatars/${userId}.${ext}` });
    return { user };
  });

  app.delete("/api/auth/me/avatar", { preHandler: [authenticate] }, async (request) => {
    const userId = currentUserId(request);
    removeUserAvatarFiles(ctx, userId);
    const user = updateUserProfile(ctx.db, userId, { avatar: null });
    return { user };
  });

  app.get("/api/auth/avatars/:file", async (request, reply) => {
    const file = (request.params as { file: string }).file;
    if (!AVATAR_URL_RE.test(file)) {
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    }
    try {
      if (request.headers.authorization?.startsWith("Bearer ")) {
        await request.jwtVerify();
      } else {
        const token = (request.query as { token?: string }).token;
        if (!token) throw new Error("no token");
        request.user = app.jwt.verify(token) as never;
      }
    } catch {
      return reply.code(401).send({ error: "unauthorized", message: "Unauthorized" });
    }
    const dir = subDir(ctx.config, "avatars");
    const filePath = path.join(dir, file);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    }
    const ext = file.split(".").pop() ?? "";
    return reply.type(avatarMime(ext)).send(fs.createReadStream(filePath));
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
