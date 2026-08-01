import net from "node:net";
import type { Db } from "../db.js";

export const PORTS_PER_SERVER = 5;
export const RCON_PORT_OFFSET = 1;
export const QUERY_PORT_OFFSET = 2;

export function serverBlock(port: number): number[] {
  return [port, port + 1, port + 2, port + 3, port + 4];
}

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

function reservedPorts(db: Db, excludeServerId?: string): Set<number> {
  const set = new Set<number>();
  const rows = (excludeServerId
    ? db.prepare("SELECT port FROM servers WHERE id != ?").all(excludeServerId)
    : db.prepare("SELECT port FROM servers").all()) as { port: number }[];
  for (const row of rows) {
    for (const p of serverBlock(row.port)) set.add(p);
  }
  return set;
}

export async function isPortBlockFree(
  db: Db,
  port: number,
  excludeServerId?: string,
): Promise<boolean> {
  if (port > 65535 - (PORTS_PER_SERVER - 1)) return false;
  const reserved = reservedPorts(db, excludeServerId);
  for (const p of serverBlock(port)) {
    if (reserved.has(p)) return false;
    if (!(await isPortFree(p))) return false;
  }
  return true;
}

export async function nextFreePort(
  db: Db,
  from: number,
  excludeServerId?: string,
  limit = 50,
): Promise<number> {
  const reserved = reservedPorts(db, excludeServerId);
  for (let p = from; p < from + limit && p <= 65535 - (PORTS_PER_SERVER - 1); p++) {
    if (serverBlock(p).some((b) => reserved.has(b))) continue;
    let ok = true;
    for (const b of serverBlock(p)) {
      if (!(await isPortFree(b))) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  throw new Error(`No free port block found starting from ${from}`);
}

export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
