import { useEffect, useState } from "react";
import { api } from "../api";

export interface PortStatus {
  port: number | null;
  available: boolean;
  usedBy: string | null;
  checking: boolean;
  error: string | null;
}

const IDLE: PortStatus = { port: null, available: true, usedBy: null, checking: false, error: null };

export function usePortAvailability(port: number | null, excludeServerId?: string): PortStatus {
  const [state, setState] = useState<PortStatus>(IDLE);

  useEffect(() => {
    if (!port) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, checking: true, error: null }));
    const timer = setTimeout(() => {
      void api
        .checkPort(port, excludeServerId)
        .then((res) => {
          if (!cancelled) {
            setState({ port, available: res.available, usedBy: res.usedBy, checking: false, error: null });
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setState({ port, available: true, usedBy: null, checking: false, error: e instanceof Error ? e.message : "check failed" });
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [port, excludeServerId]);

  return state;
}

export function PortBadge({ status }: { status: PortStatus }) {
  if (status.checking) return <span className="port-badge checking">проверка…</span>;
  if (status.error) return <span className="port-badge warn">не удалось проверить</span>;
  if (status.port !== null && !status.available) {
    return (
      <span className="port-badge busy">
        занят{status.usedBy ? `: ${status.usedBy}` : ""}
      </span>
    );
  }
  if (status.port !== null) return <span className="port-badge free">доступен</span>;
  return <span className="port-badge auto">авто: свободный от 25565</span>;
}
