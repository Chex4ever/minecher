import net from "node:net";
import type { Db } from "../db.js";

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code === "EADDRINUSE" ? false : true);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

export async function nextFreePort(
  db: Db,
  from: number,
  excludeServerId?: string,
  limit = 50,
): Promise<number> {
  const taken = new Set(
    (db
      .prepare(excludeServerId
        ? "SELECT port FROM servers WHERE id != ?"
        : "SELECT port FROM servers")
      .all(...(excludeServerId ? [excludeServerId] : [])) as { port: number }[]).map((r) => r.port),
  );
  for (let p = from; p < from + limit; p++) {
    if (taken.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found starting from ${from}`);
}

export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
