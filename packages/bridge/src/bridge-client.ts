import { createConnection, type Socket } from "node:net";

import type { BridgeMessage } from "@test-center/contracts/bridge";
import {
  BridgeProtocolParser,
  type BridgeParseResult,
  type BridgeProtocolError,
} from "./protocol.js";

type QaHello = Extract<BridgeMessage, { type: "QA_HELLO" }>;
type QaState = Extract<BridgeMessage, { type: "QA_STATE" }>;

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_LINE_LENGTH = 16 * 1024;

export type BridgeClientStatus = "disconnected" | "connecting" | "ready" | "closed" | "error";

export type BridgeLineListener = (line: string) => void;
export type BridgeCloseListener = (error?: Error) => void;

export interface BridgeLineTransport {
  connect(): Promise<void>;
  send(line: string): void;
  close(): Promise<void>;
  onLine(listener: BridgeLineListener): () => void;
  onClose(listener: BridgeCloseListener): () => void;
}

export interface TcpBridgeTransportOptions {
  readonly host?: string;
  readonly port: number;
  readonly connectTimeoutMs?: number;
}

export interface BridgeClientSnapshot {
  readonly status: BridgeClientStatus;
  readonly hello?: QaHello;
  readonly state?: QaState;
  readonly bridgeInstanceId?: string;
  readonly lastProtocolError?: BridgeProtocolError;
}

export interface BridgeClientOptions {
  readonly transport: BridgeLineTransport;
  readonly parser?: BridgeProtocolParser;
  readonly handshakeTimeoutMs?: number;
}

export type BridgeClientStatusListener = (
  status: BridgeClientStatus,
  snapshot: BridgeClientSnapshot,
) => void;
export type BridgeMessageListener = (message: BridgeMessage) => void;

export type BridgeClientErrorCode =
  "CONNECT_FAILED" | "HANDSHAKE_TIMEOUT" | "PROTOCOL_ERROR" | "TRANSPORT_CLOSED";

export class BridgeClientError extends Error {
  public constructor(
    public readonly code: BridgeClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BridgeClientError";
  }
}

export class BridgeClient {
  private readonly parser: BridgeProtocolParser;
  private readonly handshakeTimeoutMs: number;
  private readonly statusListeners = new Set<BridgeClientStatusListener>();
  private readonly messageListeners = new Set<BridgeMessageListener>();
  private status: BridgeClientStatus = "disconnected";
  private hello: QaHello | undefined;
  private state: QaState | undefined;
  private lastProtocolError: BridgeProtocolError | undefined;
  private removeLineListener: (() => void) | undefined;
  private removeCloseListener: (() => void) | undefined;
  private connectPromise: Promise<void> | undefined;
  private handshakeResolve: (() => void) | undefined;
  private handshakeReject: ((error: Error) => void) | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly options: BridgeClientOptions) {
    this.parser = options.parser ?? new BridgeProtocolParser();
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    if (!Number.isFinite(this.handshakeTimeoutMs) || this.handshakeTimeoutMs <= 0) {
      throw new TypeError("handshakeTimeoutMs must be greater than zero.");
    }
  }

  public getSnapshot(): BridgeClientSnapshot {
    return {
      status: this.status,
      ...(this.hello === undefined
        ? {}
        : { hello: this.hello, bridgeInstanceId: this.hello.bridgeInstanceId }),
      ...(this.state === undefined ? {} : { state: this.state }),
      ...(this.lastProtocolError === undefined
        ? {}
        : { lastProtocolError: this.lastProtocolError }),
    };
  }

  public onStatusChange(listener: BridgeClientStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onMessage(listener: BridgeMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public async connect(): Promise<void> {
    if (this.status === "ready") return;
    if (this.connectPromise !== undefined) return await this.connectPromise;

    this.connectPromise = this.open();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  public send(message: unknown): void {
    if (this.status !== "ready") {
      throw new BridgeClientError("CONNECT_FAILED", "Bridge client is not ready.");
    }
    this.options.transport.send(`${JSON.stringify(message)}\n`);
  }

  public async close(): Promise<void> {
    this.clearHandshakeWaiter();
    this.removeTransportListeners();
    await this.options.transport.close();
    this.setStatus("closed");
  }

  private async open(): Promise<void> {
    this.hello = undefined;
    this.state = undefined;
    this.lastProtocolError = undefined;
    this.setStatus("connecting");
    this.removeLineListener = this.options.transport.onLine((line) => this.handleLine(line));
    this.removeCloseListener = this.options.transport.onClose((error) => this.handleClose(error));

    try {
      await this.options.transport.connect();
      await this.waitForHandshake();
    } catch (error) {
      this.clearHandshakeWaiter();
      this.removeTransportListeners();
      try {
        await this.options.transport.close();
      } catch {
        // Preserve the original connection or handshake failure.
      }
      if (this.status !== "closed") this.setStatus("error");
      if (error instanceof BridgeClientError) throw error;
      throw new BridgeClientError("CONNECT_FAILED", "Unable to connect to the Unity QA bridge.", {
        cause: error,
      });
    }
  }

  private waitForHandshake(): Promise<void> {
    if (this.hello !== undefined && this.state !== undefined) {
      this.setStatus("ready");
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;
      this.handshakeTimer = setTimeout(() => {
        this.clearHandshakeWaiter();
        reject(
          new BridgeClientError(
            "HANDSHAKE_TIMEOUT",
            "Unity QA bridge did not provide QA_HELLO and QA_STATE before the handshake timeout.",
          ),
        );
      }, this.handshakeTimeoutMs);
    });
  }

  private handleLine(line: string): void {
    const parsed: BridgeParseResult = this.parser.parseLine(line);
    if (!parsed.ok) {
      this.lastProtocolError = parsed.error;
      if (this.hello === undefined || this.state === undefined) {
        this.handshakeReject?.(new BridgeClientError("PROTOCOL_ERROR", parsed.error.message));
        this.clearHandshakeWaiter();
        this.setStatus("error");
      }
      return;
    }

    this.messageListeners.forEach((listener) => listener(parsed.message));
    if (parsed.message.type === "QA_HELLO") this.handleHello(parsed.message);
    if (parsed.message.type === "QA_STATE") this.handleState(parsed.message);
  }

  private handleHello(message: QaHello): void {
    if (
      this.hello !== undefined &&
      (this.hello.bridgeInstanceId !== message.bridgeInstanceId ||
        this.hello.bootId !== message.bootId)
    ) {
      this.state = undefined;
      this.setStatus("connecting");
    }
    this.hello = message;
    this.completeHandshakeIfReady();
  }

  private handleState(message: QaState): void {
    if (this.hello?.bridgeInstanceId !== message.bridgeInstanceId) return;
    this.state = message;
    this.completeHandshakeIfReady();
  }

  private completeHandshakeIfReady(): void {
    if (this.hello === undefined || this.state === undefined) return;
    this.setStatus("ready");
    this.handshakeResolve?.();
    this.clearHandshakeWaiter();
  }

  private handleClose(error?: Error): void {
    this.removeTransportListeners();
    const handshakeReject = this.handshakeReject;
    this.clearHandshakeWaiter();
    if (this.status === "closed") return;
    this.setStatus("error");
    handshakeReject?.(
      new BridgeClientError("TRANSPORT_CLOSED", "Unity QA bridge transport closed.", {
        cause: error,
      }),
    );
  }

  private clearHandshakeWaiter(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.handshakeResolve = undefined;
    this.handshakeReject = undefined;
  }

  private removeTransportListeners(): void {
    this.removeLineListener?.();
    this.removeCloseListener?.();
    this.removeLineListener = undefined;
    this.removeCloseListener = undefined;
  }

  private setStatus(status: BridgeClientStatus): void {
    if (this.status === status) return;
    this.status = status;
    const snapshot = this.getSnapshot();
    this.statusListeners.forEach((listener) => listener(status, snapshot));
  }
}

export function createTcpBridgeTransport(options: TcpBridgeTransportOptions): BridgeLineTransport {
  const host = options.host ?? "127.0.0.1";
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new TypeError("port must be an integer TCP port between 1 and 65535.");
  }
  if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0) {
    throw new TypeError("connectTimeoutMs must be greater than zero.");
  }

  let socket: Socket | undefined;
  let connected = false;
  let buffer = "";
  const lineListeners = new Set<BridgeLineListener>();
  const closeListeners = new Set<BridgeCloseListener>();

  return {
    connect: async () => {
      if (connected) return;
      await new Promise<void>((resolve, reject) => {
        const candidate = createConnection({ host, port: options.port });
        socket = candidate;
        const timer = setTimeout(() => {
          candidate.destroy();
          reject(new BridgeClientError("CONNECT_FAILED", "TCP bridge connection timed out."));
        }, connectTimeoutMs);
        candidate.setEncoding("utf8");
        candidate.on("connect", () => {
          clearTimeout(timer);
          connected = true;
          resolve();
        });
        candidate.on("data", (chunk: string) => {
          buffer += chunk;
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);
            lineListeners.forEach((listener) => listener(line));
            newlineIndex = buffer.indexOf("\n");
          }
          if (buffer.length > MAX_LINE_LENGTH) {
            const oversized = buffer;
            buffer = "";
            lineListeners.forEach((listener) => listener(oversized));
          }
        });
        candidate.on("error", (error) => {
          clearTimeout(timer);
          if (!connected) reject(error);
          else closeListeners.forEach((listener) => listener(error));
        });
        candidate.on("close", () => {
          connected = false;
          socket = undefined;
          closeListeners.forEach((listener) => listener());
        });
      });
    },
    send: (line: string) => {
      if (!socket || !connected)
        throw new BridgeClientError("TRANSPORT_CLOSED", "TCP bridge is closed.");
      socket.write(line);
    },
    close: async () => {
      if (!socket) return;
      const current: Socket = socket;
      if (current.destroyed) {
        socket = undefined;
        connected = false;
        return;
      }
      await new Promise<void>((resolve) => {
        current.once("close", () => resolve());
        current.destroy();
      });
    },
    onLine: (listener) => {
      lineListeners.add(listener);
      return () => lineListeners.delete(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
  };
}
