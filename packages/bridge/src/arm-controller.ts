import type { BridgeHash, BridgeMessage } from "@test-center/contracts/bridge";
import type { BridgeClientSnapshot } from "./bridge-client.js";

type QaAck = Extract<BridgeMessage, { type: "QA_ACK" }>;
type QaArmed = Extract<BridgeMessage, { type: "QA_ARMED" }>;
type QaHello = Extract<BridgeMessage, { type: "QA_HELLO" }>;
type QaRejected = Extract<BridgeMessage, { type: "QA_REJECTED" }>;

const DEFAULT_ARM_TIMEOUT_MS = 10_000;

export interface ArmRequest {
  readonly runNonceHash: BridgeHash;
  readonly actionId: string;
  readonly descriptorHash: BridgeHash;
  readonly expectedEventShapeHash: BridgeHash;
  readonly expectedView: string;
  readonly expectedFocus: string | null;
  readonly metricsEpoch: number;
  readonly expiresAtRealtimeMs: string;
  readonly timeoutMs?: number;
}

export interface ArmLease {
  readonly actionId: string;
  readonly bridgeInstanceId: string;
  readonly descriptorHash: BridgeHash;
  readonly expiresAtRealtimeMs: string;
  waitForAck(): Promise<QaAck>;
  cancel(): Promise<void>;
}

export interface ArmControllerClient {
  getSnapshot(): BridgeClientSnapshot;
  send(message: unknown): void;
  onMessage(listener: (message: BridgeMessage) => void): () => void;
  onStatusChange(
    listener: (status: BridgeClientSnapshot["status"], snapshot: BridgeClientSnapshot) => void,
  ): () => void;
}

export interface ArmControllerOptions {
  readonly defaultArmTimeoutMs?: number;
}

export type ArmControllerErrorCode =
  | "BRIDGE_NOT_READY"
  | "ARM_ALREADY_ACTIVE"
  | "ARM_REJECTED"
  | "ARM_DESCRIPTOR_MISMATCH"
  | "ARM_BRIDGE_CHANGED"
  | "ARM_TIMEOUT"
  | "ARM_CANCELLED"
  | "ARM_NOT_FOUND"
  | "ARM_ALREADY_CONSUMED";

export class ArmControllerError extends Error {
  public constructor(
    public readonly code: ArmControllerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArmControllerError";
  }
}

export class ArmController {
  private readonly defaultArmTimeoutMs: number;
  private readonly leases = new Map<string, InternalArmLease>();
  private readonly removeMessageListener: () => void;
  private readonly removeStatusListener: () => void;
  private currentIdentity: BridgeIdentity | undefined;

  public constructor(
    private readonly client: ArmControllerClient,
    options: ArmControllerOptions = {},
  ) {
    this.defaultArmTimeoutMs = options.defaultArmTimeoutMs ?? DEFAULT_ARM_TIMEOUT_MS;
    if (!Number.isFinite(this.defaultArmTimeoutMs) || this.defaultArmTimeoutMs <= 0) {
      throw new TypeError("defaultArmTimeoutMs must be greater than zero.");
    }
    this.removeMessageListener = client.onMessage((message) => this.handleMessage(message));
    this.removeStatusListener = client.onStatusChange((status) => {
      if (status !== "ready") this.invalidateAll("ARM_BRIDGE_CHANGED");
    });
  }

  public async arm(request: ArmRequest): Promise<ArmLease> {
    const identity = getReadyIdentity(this.client.getSnapshot());
    validateArmRequest(request);
    if (this.leases.has(request.actionId)) {
      throw new ArmControllerError(
        "ARM_ALREADY_ACTIVE",
        `Action ${request.actionId} is already armed.`,
      );
    }
    this.currentIdentity = identity;

    const lease = new InternalArmLease(request, identity.bridgeInstanceId, {
      release: () => this.releaseLease(request.actionId),
      disarm: () => this.disarmLease(request.actionId),
    });
    this.leases.set(request.actionId, lease);
    lease.startTimeout(request.timeoutMs ?? this.defaultArmTimeoutMs);
    try {
      this.client.send({
        type: "QA_ARM",
        schemaVersion: 1,
        runNonceHash: request.runNonceHash,
        actionId: request.actionId,
        descriptorHash: request.descriptorHash,
        expectedEventShapeHash: request.expectedEventShapeHash,
        expectedView: request.expectedView,
        expectedFocus: request.expectedFocus,
        metricsEpoch: request.metricsEpoch,
        expiresAtRealtimeMs: request.expiresAtRealtimeMs,
      });
    } catch (error) {
      this.removeLease(request.actionId, "ARM_CANCELLED", error);
    }
    return await lease.waitUntilArmed();
  }

  public async cancel(actionId: string): Promise<void> {
    const lease = this.leases.get(actionId);
    if (lease === undefined) {
      throw new ArmControllerError("ARM_NOT_FOUND", `Action ${actionId} is not armed.`);
    }
    await lease.cancel();
  }

  public dispose(): void {
    this.removeMessageListener();
    this.removeStatusListener();
    this.invalidateAll("ARM_CANCELLED");
  }

  private handleMessage(message: BridgeMessage): void {
    if (message.type === "QA_HELLO") {
      this.handleHello(message);
      return;
    }
    if (message.type === "QA_ARMED") {
      this.handleArmed(message);
      return;
    }
    if (message.type === "QA_REJECTED") {
      this.handleRejected(message);
      return;
    }
    if (message.type === "QA_ACK") {
      const lease = this.leases.get(message.actionId);
      if (lease === undefined) return;
      if (!lease.matchesAck(message)) {
        this.removeLease(
          message.actionId,
          "ARM_DESCRIPTOR_MISMATCH",
          new ArmControllerError(
            "ARM_DESCRIPTOR_MISMATCH",
            `QA_ACK ${message.actionId} did not match the arm descriptor.`,
          ),
        );
        return;
      }
      lease.resolveAck(message);
    }
  }

  private handleHello(message: QaHello): void {
    const nextIdentity: BridgeIdentity = {
      bridgeInstanceId: message.bridgeInstanceId,
      bootId: message.bootId,
    };
    if (
      this.currentIdentity !== undefined &&
      (this.currentIdentity.bridgeInstanceId !== nextIdentity.bridgeInstanceId ||
        this.currentIdentity.bootId !== nextIdentity.bootId)
    ) {
      this.invalidateAll("ARM_BRIDGE_CHANGED");
    }
    this.currentIdentity = nextIdentity;
  }

  private handleArmed(message: QaArmed): void {
    const lease = this.leases.get(message.actionId);
    if (lease === undefined) return;
    if (!lease.matchesArmed(message)) {
      this.removeLease(
        message.actionId,
        "ARM_DESCRIPTOR_MISMATCH",
        new ArmControllerError(
          "ARM_DESCRIPTOR_MISMATCH",
          `QA_ARMED ${message.actionId} does not match the requested arm descriptor.`,
        ),
      );
      return;
    }
    lease.resolveArmed();
  }

  private handleRejected(message: QaRejected): void {
    if (message.actionId === undefined) return;
    this.removeLease(
      message.actionId,
      "ARM_REJECTED",
      new ArmControllerError("ARM_REJECTED", `${message.code}: ${message.reason}`),
    );
  }

  private invalidateAll(code: "ARM_BRIDGE_CHANGED" | "ARM_CANCELLED"): void {
    for (const actionId of [...this.leases.keys()]) {
      this.removeLease(
        actionId,
        code,
        new ArmControllerError(
          code,
          code === "ARM_BRIDGE_CHANGED"
            ? "Bridge instance changed; all arm leases were invalidated."
            : "Arm controller was disposed; all leases were cancelled.",
        ),
      );
    }
  }

  private removeLease(actionId: string, code: ArmControllerErrorCode, error: unknown): void {
    const lease = this.leases.get(actionId);
    if (lease === undefined) return;
    this.leases.delete(actionId);
    lease.stopTimeout();
    if (code !== "ARM_REJECTED") {
      try {
        this.client.send({ type: "QA_DISARM", schemaVersion: 1, actionId });
      } catch {
        // The bridge may already be disconnected; the local lease is still fenced.
      }
    }
    lease.reject(error instanceof Error ? error : new ArmControllerError(code, String(error)));
  }

  private releaseLease(actionId: string): void {
    this.leases.delete(actionId);
  }

  private disarmLease(actionId: string): void {
    try {
      this.client.send({ type: "QA_DISARM", schemaVersion: 1, actionId });
    } catch {
      // The local cancellation remains effective even if transport cleanup fails.
    }
  }
}

class InternalArmLease implements ArmLease {
  public readonly actionId: string;
  public readonly bridgeInstanceId: string;
  public readonly descriptorHash: BridgeHash;
  public readonly expiresAtRealtimeMs: string;
  private armed = false;
  private consumed = false;
  private cancelled = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private readonly armedPromise: Promise<ArmLease>;
  private resolveArmedPromise!: (lease: ArmLease) => void;
  private rejectArmedPromise!: (error: Error) => void;
  private readonly ackPromise: Promise<QaAck>;
  private resolveAckPromise!: (ack: QaAck) => void;
  private rejectAckPromise!: (error: Error) => void;
  private readonly release: () => void;
  private readonly disarm: () => void;

  public constructor(
    private readonly request: ArmRequest,
    bridgeInstanceId: string,
    callbacks: { readonly release: () => void; readonly disarm: () => void },
  ) {
    this.actionId = request.actionId;
    this.bridgeInstanceId = bridgeInstanceId;
    this.descriptorHash = request.descriptorHash;
    this.expiresAtRealtimeMs = request.expiresAtRealtimeMs;
    this.release = callbacks.release;
    this.disarm = callbacks.disarm;
    this.armedPromise = new Promise<ArmLease>((resolve, reject) => {
      this.resolveArmedPromise = resolve;
      this.rejectArmedPromise = reject;
    });
    this.ackPromise = new Promise<QaAck>((resolve, reject) => {
      this.resolveAckPromise = resolve;
      this.rejectAckPromise = reject;
    });
    this.ackPromise.catch(() => undefined);
  }

  public startTimeout(timeoutMs: number): void {
    this.timeout = setTimeout(() => {
      this.release();
      this.disarm();
      this.reject(new ArmControllerError("ARM_TIMEOUT", `Arm ${this.actionId} expired locally.`));
    }, timeoutMs);
  }

  public stopTimeout(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  public waitUntilArmed(): Promise<ArmLease> {
    return this.armedPromise;
  }

  public waitForAck(): Promise<QaAck> {
    if (this.consumed) {
      return Promise.reject(
        new ArmControllerError(
          "ARM_ALREADY_CONSUMED",
          `Arm ${this.actionId} was already consumed.`,
        ),
      );
    }
    return this.ackPromise.then((ack) => {
      this.consumed = true;
      this.release();
      this.stopTimeout();
      return ack;
    });
  }

  public async cancel(): Promise<void> {
    if (this.cancelled || this.consumed) return;
    this.cancelled = true;
    this.release();
    this.disarm();
    const error = new ArmControllerError("ARM_CANCELLED", `Arm ${this.actionId} was cancelled.`);
    this.reject(error);
  }

  public matchesArmed(message: QaArmed): boolean {
    return (
      !this.cancelled &&
      message.bridgeInstanceId === this.bridgeInstanceId &&
      message.actionId === this.actionId &&
      message.runNonceHash === this.request.runNonceHash &&
      message.descriptorHash === this.request.descriptorHash &&
      message.expectedEventShapeHash === this.request.expectedEventShapeHash &&
      message.expectedView === this.request.expectedView &&
      message.expectedFocus === this.request.expectedFocus &&
      message.metricsEpoch === this.request.metricsEpoch &&
      message.expiresAtRealtimeMs === this.request.expiresAtRealtimeMs
    );
  }

  public matchesAck(ack: QaAck): boolean {
    return (
      !this.cancelled &&
      this.armed &&
      ack.bridgeInstanceId === this.bridgeInstanceId &&
      ack.actionId === this.actionId &&
      ack.descriptorHash === this.request.descriptorHash &&
      ack.eventShapeHash === this.request.expectedEventShapeHash &&
      ack.view === this.request.expectedView &&
      (ack.focusedControlId ?? null) === this.request.expectedFocus &&
      ack.metricsEpoch === this.request.metricsEpoch
    );
  }

  public resolveArmed(): void {
    if (this.cancelled || this.armed) return;
    this.armed = true;
    this.resolveArmedPromise(this);
  }

  public resolveAck(ack: QaAck): void {
    if (!this.armed || this.cancelled || this.consumed) return;
    this.resolveAckPromise(ack);
  }

  public reject(error: Error): void {
    this.cancelled = true;
    this.stopTimeout();
    this.rejectArmedPromise(error);
    this.rejectAckPromise(error);
  }
}

interface BridgeIdentity {
  readonly bridgeInstanceId: string;
  readonly bootId: string;
}

function getReadyIdentity(snapshot: BridgeClientSnapshot): BridgeIdentity {
  if (snapshot.status !== "ready" || snapshot.hello === undefined) {
    throw new ArmControllerError("BRIDGE_NOT_READY", "QA arm requires a ready Unity QA bridge.");
  }
  return {
    bridgeInstanceId: snapshot.hello.bridgeInstanceId,
    bootId: snapshot.hello.bootId,
  };
}

function validateArmRequest(request: ArmRequest): void {
  if (!request.actionId || !request.descriptorHash || !request.expectedEventShapeHash) {
    throw new TypeError("actionId, descriptorHash, and expectedEventShapeHash are required.");
  }
  if (!Number.isSafeInteger(request.metricsEpoch) || request.metricsEpoch < 0) {
    throw new TypeError("metricsEpoch must be a non-negative safe integer.");
  }
  try {
    if (BigInt(request.expiresAtRealtimeMs) <= 0n) throw new Error("expired");
  } catch {
    throw new TypeError("expiresAtRealtimeMs must be a positive decimal string.");
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)
  ) {
    throw new TypeError("timeoutMs must be greater than zero.");
  }
}
