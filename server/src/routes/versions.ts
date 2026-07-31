import type { FastifyInstance } from "fastify";
import type { AppContext } from "../services/context.js";
import { getSource, listSourceTypes } from "../versions/index.js";
import { authenticate } from "./auth.js";

export function versionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/versions", { preHandler: [authenticate] }, async () => {
    return { types: listSourceTypes() };
  });

  app.get(
    "/api/versions/:type",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const type = (request.params as { type: string }).type;
      if (!listSourceTypes().includes(type as never)) {
        return reply.code(400).send({ error: "bad_type", message: `Unknown type: ${type}` });
      }
      try {
        const versions = await getSource(type as never).listVersions();
        return { type, versions };
      } catch (err) {
        return reply.code(502).send({ error: "source_failed", message: String(err) });
      }
    },
  );

  app.get(
    "/api/versions/:type/:version/loaders",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { type, version } = request.params as { type: string; version: string };
      if (!listSourceTypes().includes(type as never)) {
        return reply.code(400).send({ error: "bad_type", message: `Unknown type: ${type}` });
      }
      try {
        const loaders = await getSource(type as never).listLoaderVersions(version);
        return { type, version, loaders };
      } catch (err) {
        return reply.code(502).send({ error: "source_failed", message: String(err) });
      }
    },
  );
}
