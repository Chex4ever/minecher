import { EventEmitter } from "node:events";
import type { ServerEvent } from "@minecher/types";

export class EventBus extends EventEmitter {
  emitServerEvent(event: ServerEvent): void {
    this.emit("server-event", event);
  }

  onServerEvent(listener: (event: ServerEvent) => void): () => void {
    this.on("server-event", listener);
    return () => this.off("server-event", listener);
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}
