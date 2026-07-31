import net from "node:net";
import type { AppConfig } from "../config.js";
import type { ServerRepository } from "./serverRepository.js";
import type { LogStore } from "./logStore.js";
import { subDir } from "../config.js";

interface Packet {
  type: number;
  id: number;
  body: string;
}

interface Pending {
  id: number;
  resolve: (packet: Packet) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const TYPE_RESPONSE = 0;
const TYPE_COMMAND = 2;
const TYPE_AUTH = 3;

export class RconClient {
  private socket: net.Socket | null = null;
  private nextId = 0;
  private queue: Pending[] = [];
  private buf = Buffer.alloc(0);

  constructor(
    private config: AppConfig,
    private servers: ServerRepository,
    private logs: LogStore,
  ) {}

  private serverDir(serverId: string): string {
    return subDir(this.config, "servers", serverId);
  }

  getEnabled(serverId: string): { host: string; port: number; password: string } | null {
    const server = this.servers.byId(serverId);
    if (!server) return null;
    const props = server.serverProps;
    if (props["enable-rcon"] !== "true") return null;
    return {
      host: "127.0.0.1",
      port: Number(props["rcon.port"] ?? 25575),
      password: props["rcon.password"] ?? "",
    };
  }

  private openSocket(opts: { host: string; port: number }): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: opts.host, port: opts.port });
      socket.setTimeout(5000);
      socket.once("connect", () => {
        socket.setTimeout(0);
        resolve(socket);
      });
      socket.once("error", (err) => reject(err));
    });
  }

  async connect(serverId: string): Promise<boolean> {
    const cfg = this.getEnabled(serverId);
    if (!cfg) return false;
    try {
      this.socket = await this.openSocket({ host: cfg.host, port: cfg.port });
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", () => this.close());
      this.socket.on("close", () => this.close());
      const auth = await this.sendPacket(TYPE_AUTH, cfg.password);
      return auth.type === TYPE_RESPONSE;
    } catch {
      this.close();
      return false;
    }
  }

  private close(): void {
    for (const item of this.queue) {
      clearTimeout(item.timer);
      item.reject(new Error("RCON connection closed"));
    }
    this.queue = [];
    this.socket?.destroy();
    this.socket = null;
  }

  private sendPacket(type: number, body: string): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.destroyed) {
        reject(new Error("RCON not connected"));
        return;
      }
      const id = ++this.nextId;
      const bodyBuf = Buffer.from(body, "utf8");
      const len = 4 + 4 + bodyBuf.length + 2;
      const frame = Buffer.alloc(4 + len);
      frame.writeInt32LE(len, 0);
      frame.writeInt32LE(id, 4);
      frame.writeInt32LE(type, 8);
      bodyBuf.copy(frame, 12);
      const item: Pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.queue = this.queue.filter((q) => q.id !== id);
          reject(new Error("RCON response timeout"));
        }, 10_000),
      };
      item.timer.unref?.();
      this.queue.push(item);
      socket.write(frame);
    });
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const size = this.buf.readInt32LE(0);
      if (this.buf.length < 4 + size) break;
      const frame = this.buf.subarray(4, 4 + size);
      this.buf = this.buf.subarray(4 + size);
      const id = frame.readInt32LE(0);
      const type = frame.readInt32LE(4);
      const body = frame.subarray(8, -2).toString("utf8");
      const item = this.queue.find((q) => q.id === id);
      if (item) {
        clearTimeout(item.timer);
        this.queue = this.queue.filter((q) => q.id !== id);
        item.resolve({ id, type, body });
      }
    }
  }

  async send(serverId: string, command: string): Promise<{ ok: boolean; body?: string; error?: string }> {
    if (!this.socket || this.socket.destroyed) {
      const connected = await this.connect(serverId);
      if (!connected) {
        return { ok: false, error: "RCON not available (enable-rcon not set or unreachable)" };
      }
    }
    try {
      const resp = await this.sendPacket(TYPE_COMMAND, command);
      return { ok: true, body: resp.body };
    } catch (err) {
      this.close();
      return { ok: false, error: String(err) };
    }
  }
}
