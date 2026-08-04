import type { HealthSnapshot } from "./api";

export interface StateEvent {
  type: "snapshot" | "delta";
  eventSeq: number;
  snapshot?: HealthSnapshot;
}

export function openStateStream(
  onEvent: (event: StateEvent) => void,
  onStatus: (connected: boolean) => void,
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/state`);
  socket.addEventListener("open", () => onStatus(true));
  socket.addEventListener("close", () => onStatus(false));
  socket.addEventListener("error", () => onStatus(false));
  socket.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(String(message.data)) as StateEvent;
      if (event.type === "snapshot" || event.type === "delta") onEvent(event);
    } catch {
      // Ignore malformed state frames; the health polling path remains authoritative.
    }
  });
  return socket;
}
