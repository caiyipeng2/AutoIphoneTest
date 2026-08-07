import type { BridgeMessage, QaHelloSchema, QaStateSchema } from "@test-center/contracts/bridge";
import type { DeviceSerial } from "@test-center/contracts/device";
import type { z } from "zod";

import { UidService } from "./uid-service.js";

type QaHello = z.infer<typeof QaHelloSchema>;
type QaState = z.infer<typeof QaStateSchema>;

export type BridgeClientStatus = "disconnected" | "connecting" | "ready" | "closed" | "error";

export interface BridgeMessageSourceSnapshot {
  readonly status: BridgeClientStatus;
  readonly hello?: QaHello;
  readonly state?: QaState;
}

export interface BridgeMessageSource {
  getSnapshot(): BridgeMessageSourceSnapshot;
  onMessage(listener: (message: BridgeMessage) => void): () => void;
  onStatusChange(listener: (status: BridgeClientStatus) => void): () => void;
}

export interface BridgeStateIngestorOptions {
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly source: BridgeMessageSource;
  readonly uidService: UidService;
  readonly now?: () => string;
  readonly onError?: (error: Error) => void;
}

export class BridgeStateIngestor {
  private readonly now: () => string;
  private readonly onError: (error: Error) => void;
  private active = false;
  private hello: QaHello | undefined;
  private removeMessageListener: (() => void) | undefined;
  private removeStatusListener: (() => void) | undefined;

  public constructor(private readonly options: BridgeStateIngestorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.onError = options.onError ?? (() => undefined);
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.removeMessageListener = this.options.source.onMessage((message) =>
      this.handleMessage(message),
    );
    this.removeStatusListener = this.options.source.onStatusChange((status) =>
      this.handleStatus(status),
    );
    const current = this.options.source.getSnapshot();
    this.hello = current.hello;
    if (current.state !== undefined) this.handleState(current.state);
  }

  public stop(): void {
    this.removeMessageListener?.();
    this.removeStatusListener?.();
    this.removeMessageListener = undefined;
    this.removeStatusListener = undefined;
    this.active = false;
    this.hello = undefined;
  }

  private handleMessage(message: BridgeMessage): void {
    if (message.type === "QA_HELLO") {
      this.hello = message;
      return;
    }
    if (message.type === "QA_STATE") this.handleState(message);
  }

  private handleState(message: QaState): void {
    const hello = this.hello;
    if (hello === undefined) {
      this.report(new Error("QA_STATE received before QA_HELLO."));
      return;
    }
    if (hello.bridgeInstanceId !== message.bridgeInstanceId) {
      this.report(new Error("QA_STATE bridge instance does not match QA_HELLO."));
      return;
    }
    try {
      this.options.uidService.observeBridgeState({
        serial: this.options.serial,
        packageName: this.options.packageName,
        bridgeInstanceId: message.bridgeInstanceId,
        bootId: hello.bootId,
        buildId: message.buildId,
        uid: message.uid,
        installGeneration: message.installGeneration,
        appDataGeneration: message.appDataGeneration,
        stateSeq: message.stateSeq,
        observedAt: this.now(),
      });
    } catch (error) {
      this.report(error);
    }
  }

  private handleStatus(status: BridgeClientStatus): void {
    if (status !== "disconnected" && status !== "closed" && status !== "error") return;
    try {
      this.options.uidService.markBridgeUnavailable(
        this.options.serial,
        this.options.packageName,
        `Unity QA bridge status: ${status}.`,
      );
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    this.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
