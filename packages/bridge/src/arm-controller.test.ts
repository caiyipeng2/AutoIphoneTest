import { describe, expect, it } from "vitest";

import type { BridgeHash, BridgeMessage } from "@test-center/contracts/bridge";
import type { BridgeClientSnapshot } from "./bridge-client.js";
import {
  ArmController,
  ArmControllerError,
  type ArmControllerClient,
  type ArmRequest,
} from "./arm-controller.js";

const instance = "bridge-instance-a";
const hashA = `sha256:${"a".repeat(64)}` as BridgeHash;
const hashB = `sha256:${"b".repeat(64)}` as BridgeHash;

const request: ArmRequest = {
  runNonceHash: hashA,
  actionId: "ACT-1",
  descriptorHash: hashA,
  expectedEventShapeHash: hashB,
  expectedView: "MainHUD",
  expectedFocus: null,
  metricsEpoch: 12,
  expiresAtRealtimeMs: "10500",
  timeoutMs: 100,
};

function armed(overrides: Partial<BridgeMessage> = {}): BridgeMessage {
  return {
    type: "QA_ARMED",
    schemaVersion: 1,
    bridgeInstanceId: instance,
    runNonceHash: hashA,
    actionId: "ACT-1",
    descriptorHash: hashA,
    expectedEventShapeHash: hashB,
    expectedView: "MainHUD",
    expectedFocus: null,
    metricsEpoch: 12,
    expiresAtRealtimeMs: "10500",
    ...overrides,
  } as BridgeMessage;
}

function ack(overrides: Partial<BridgeMessage> = {}): BridgeMessage {
  return {
    type: "QA_ACK",
    schemaVersion: 1,
    bridgeInstanceId: instance,
    actionId: "ACT-1",
    observedAtRealtimeNs: "9812345000000",
    descriptorHash: hashA,
    eventShapeHash: hashB,
    view: "MainHUD",
    focusedControlId: null,
    metricsEpoch: 12,
    stateSeq: 2,
    ...overrides,
  } as BridgeMessage;
}

class FakeArmClient implements ArmControllerClient {
  public snapshot: BridgeClientSnapshot = {
    status: "ready",
    hello: {
      type: "QA_HELLO",
      schemaVersion: 1,
      bridgeInstanceId: instance,
      bootId: "boot-1",
      buildId: "qa-1",
    },
  };
  public readonly sent: unknown[] = [];
  private readonly messageListeners = new Set<(message: BridgeMessage) => void>();
  private readonly statusListeners = new Set<
    (status: BridgeClientSnapshot["status"], snapshot: BridgeClientSnapshot) => void
  >();

  public getSnapshot(): BridgeClientSnapshot {
    return this.snapshot;
  }

  public send(message: unknown): void {
    this.sent.push(message);
  }

  public onMessage(listener: (message: BridgeMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onStatusChange(
    listener: (status: BridgeClientSnapshot["status"], snapshot: BridgeClientSnapshot) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public emit(message: BridgeMessage): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  public emitStatus(status: BridgeClientSnapshot["status"]): void {
    this.snapshot = { ...this.snapshot, status };
    this.statusListeners.forEach((listener) => listener(status, this.snapshot));
  }
}

describe("ArmController", () => {
  it("returns a lease only after matching QA_ARMED and consumes one matching QA_ACK", async () => {
    const client = new FakeArmClient();
    const controller = new ArmController(client);
    const armPromise = controller.arm(request);
    await Promise.resolve();
    expect(client.sent).toEqual([
      {
        type: "QA_ARM",
        schemaVersion: 1,
        runNonceHash: hashA,
        actionId: "ACT-1",
        descriptorHash: hashA,
        expectedEventShapeHash: hashB,
        expectedView: "MainHUD",
        expectedFocus: null,
        metricsEpoch: 12,
        expiresAtRealtimeMs: "10500",
      },
    ]);

    client.emit(armed());
    const lease = await armPromise;
    client.emit(ack());
    await expect(lease.waitForAck()).resolves.toMatchObject({ type: "QA_ACK", actionId: "ACT-1" });
    await expect(lease.waitForAck()).rejects.toMatchObject({ code: "ARM_ALREADY_CONSUMED" });
  });

  it("rejects descriptor mismatches and sends disarm cleanup", async () => {
    const client = new FakeArmClient();
    const controller = new ArmController(client);
    const armPromise = controller.arm(request);
    await Promise.resolve();
    client.emit(armed({ descriptorHash: hashB }));
    await expect(armPromise).rejects.toMatchObject({ code: "ARM_DESCRIPTOR_MISMATCH" });
    expect(client.sent.at(-1)).toEqual({ type: "QA_DISARM", schemaVersion: 1, actionId: "ACT-1" });
  });

  it("maps bridge rejection and local timeout to lease errors", async () => {
    const rejectedClient = new FakeArmClient();
    const rejectedController = new ArmController(rejectedClient);
    const rejected = rejectedController.arm(request);
    await Promise.resolve();
    rejectedClient.emit({
      type: "QA_REJECTED",
      schemaVersion: 1,
      bridgeInstanceId: instance,
      actionId: "ACT-1",
      code: "FOCUS_MISMATCH",
      reason: "focus changed",
    });
    await expect(rejected).rejects.toMatchObject({ code: "ARM_REJECTED" });

    const timeoutClient = new FakeArmClient();
    const timeoutController = new ArmController(timeoutClient, { defaultArmTimeoutMs: 1 });
    const requestWithoutTimeout: ArmRequest = {
      runNonceHash: request.runNonceHash,
      actionId: request.actionId,
      descriptorHash: request.descriptorHash,
      expectedEventShapeHash: request.expectedEventShapeHash,
      expectedView: request.expectedView,
      expectedFocus: request.expectedFocus,
      metricsEpoch: request.metricsEpoch,
      expiresAtRealtimeMs: request.expiresAtRealtimeMs,
    };
    const timeout = timeoutController.arm(requestWithoutTimeout);
    await expect(timeout).rejects.toMatchObject({ code: "ARM_TIMEOUT" });
    expect(timeoutClient.sent.at(-1)).toEqual({
      type: "QA_DISARM",
      schemaVersion: 1,
      actionId: "ACT-1",
    });
  });

  it("invalidates a pending lease when the bridge status changes", async () => {
    const client = new FakeArmClient();
    const controller = new ArmController(client);
    const armPromise = controller.arm(request);
    await Promise.resolve();
    client.emitStatus("connecting");
    await expect(armPromise).rejects.toBeInstanceOf(ArmControllerError);
    await expect(armPromise).rejects.toMatchObject({ code: "ARM_BRIDGE_CHANGED" });
    expect(client.sent.at(-1)).toEqual({ type: "QA_DISARM", schemaVersion: 1, actionId: "ACT-1" });
  });
});
