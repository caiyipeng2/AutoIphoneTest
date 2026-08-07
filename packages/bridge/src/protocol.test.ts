import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  BridgeProtocolParser,
  canonicalizeBridgeDescriptor,
  hashBridgeDescriptor,
  parseBridgeLine,
} from "./protocol.js";

const instance = "bridge-instance-a";
const runNonceHash = `sha256:${"a".repeat(64)}`;
const descriptor = {
  actionType: "tap",
  normalizedShape: { x: 0.5, y: 0.25 },
  expectedView: "MainHUD",
  expectedFocus: null,
  metricsEpoch: 12,
} as const;
const descriptorHash = hashBridgeDescriptor(descriptor);
const eventShapeHash = `sha256:${"b".repeat(64)}`;

describe("Unity QA bridge protocol", () => {
  it("canonicalizes descriptors with sorted keys and stable SHA-256", () => {
    expect(
      canonicalizeBridgeDescriptor({
        ...descriptor,
        normalizedShape: { y: 0.25, x: 0.5 },
      }),
    ).toBe(canonicalizeBridgeDescriptor(descriptor));
    expect(descriptorHash).toBe(
      `sha256:${createHash("sha256").update(canonicalizeBridgeDescriptor(descriptor)).digest("hex")}`,
    );
  });

  it("accepts the versioned hello/state lifecycle and enforces monotonic state sequence", () => {
    const parser = new BridgeProtocolParser();
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_HELLO",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          bootId: "boot-1",
          buildId: "qa-1",
        }),
      ),
    ).toMatchObject({ ok: true, message: { type: "QA_HELLO" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_STATE",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          uid: "UID-1",
          installGeneration: 1,
          appDataGeneration: 2,
          buildId: "qa-1",
          width: 1080,
          height: 2400,
          safeArea: [0, 80, 1080, 2260],
          orientation: "Portrait",
          metricsEpoch: 12,
          view: "MainHUD",
          focusedControlId: null,
          textInputAvailable: false,
          stateSeq: 1,
        }),
      ),
    ).toMatchObject({ ok: true, message: { type: "QA_STATE", stateSeq: 1 } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_STATE",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          uid: "UID-1",
          installGeneration: 1,
          appDataGeneration: 2,
          buildId: "qa-1",
          width: 1080,
          height: 2400,
          safeArea: [0, 80, 1080, 2260],
          orientation: "Portrait",
          metricsEpoch: 12,
          view: "MainHUD",
          focusedControlId: null,
          textInputAvailable: false,
          stateSeq: 1,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "STATE_SEQUENCE_REPLAY" } });
  });

  it("keeps safe area wire shape compatible with Unity JsonUtility output", () => {
    const parser = new BridgeProtocolParser();
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_HELLO",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          bootId: "boot-1",
          buildId: "qa-1",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_STATE",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          uid: "UID-1",
          installGeneration: 1,
          appDataGeneration: 1,
          buildId: "qa-1",
          width: 1080,
          height: 2400,
          safeArea: { x: 0, y: 80, width: 1080, height: 2260 },
          orientation: "Portrait",
          metricsEpoch: 1,
          view: "MainHUD",
          focusedControlId: null,
          textInputAvailable: false,
          stateSeq: 1,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_STATE",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          uid: "UID-1",
          installGeneration: 1,
          appDataGeneration: 1,
          buildId: "qa-1",
          width: 1080,
          height: 2400,
          safeArea: [0, 80, 1080, 2260],
          orientation: "Portrait",
          metricsEpoch: 1,
          view: "MainHUD",
          focusedControlId: null,
          textInputAvailable: false,
          stateSeq: 1,
        }),
      ),
    ).toMatchObject({ ok: true, message: { type: "QA_STATE" } });
  });

  it("rejects wrong nonce, descriptor, event shape, focus, and expired arms", () => {
    const parser = new BridgeProtocolParser({
      expectedRunNonceHash: runNonceHash,
      expectedEventShapeHash: eventShapeHash,
      nowRealtimeMs: () => 10_000,
    });
    const armed = {
      type: "QA_ARMED",
      schemaVersion: 1,
      bridgeInstanceId: instance,
      runNonceHash,
      actionId: "ACT-1",
      descriptorHash,
      expectedEventShapeHash: eventShapeHash,
      expectedView: "MainHUD",
      expectedFocus: null,
      metricsEpoch: 12,
      expiresAtRealtimeMs: "10500",
    };
    expect(
      parser.parseLine(JSON.stringify({ ...armed, runNonceHash: `sha256:${"c".repeat(64)}` })),
    ).toMatchObject({ ok: false, error: { code: "RUN_NONCE_MISMATCH" } });
    expect(parser.parseLine(JSON.stringify(armed))).toMatchObject({
      ok: true,
      message: { type: "QA_ARMED" },
    });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash: `sha256:${"d".repeat(64)}`,
          eventShapeHash,
          view: "MainHUD",
          focusedControlId: null,
          metricsEpoch: 12,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "DESCRIPTOR_MISMATCH" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash,
          eventShapeHash: `sha256:${"e".repeat(64)}`,
          view: "MainHUD",
          focusedControlId: null,
          metricsEpoch: 12,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "EVENT_SHAPE_MISMATCH" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash,
          eventShapeHash,
          view: "MainHUD",
          focusedControlId: "unexpected-focus",
          metricsEpoch: 12,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "FOCUS_MISMATCH" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash,
          eventShapeHash,
          view: "MainHUD",
          focusedControlId: null,
          metricsEpoch: 13,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "METRICS_EPOCH_MISMATCH" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash,
          eventShapeHash,
          view: "MainHUD",
          focusedControlId: null,
          metricsEpoch: 12,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: true, message: { type: "QA_ACK" } });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_ACK",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          actionId: "ACT-1",
          observedAtRealtimeNs: "9812345000000",
          descriptorHash,
          eventShapeHash,
          view: "MainHUD",
          focusedControlId: null,
          metricsEpoch: 12,
          stateSeq: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "ARM_NOT_FOUND" } });

    const textParser = new BridgeProtocolParser({ nowRealtimeMs: () => 10_000 });
    expect(
      textParser.parseLine(
        JSON.stringify({
          type: "QA_STATE",
          schemaVersion: 1,
          bridgeInstanceId: instance,
          uid: null,
          installGeneration: 1,
          appDataGeneration: 1,
          buildId: "qa-1",
          width: 1080,
          height: 2400,
          safeArea: [0, 0, 1080, 2400],
          orientation: "Portrait",
          metricsEpoch: 1,
          view: "Login",
          textInputAvailable: true,
          stateSeq: 1,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "FOCUS_UNAVAILABLE" } });

    const expiredParser = new BridgeProtocolParser({ nowRealtimeMs: () => 20_000 });
    expect(expiredParser.parseLine(JSON.stringify(armed))).toMatchObject({
      ok: false,
      error: { code: "ARM_EXPIRED" },
    });
  });

  it("requires schema v1 and keeps invalid diagnostics bounded and redacted", () => {
    const diagnostics: string[] = [];
    const parser = new BridgeProtocolParser({
      diagnosticSink: (entry) => diagnostics.push(entry),
    });
    expect(parseBridgeLine("not-json")).toMatchObject({
      ok: false,
      error: { code: "INVALID_JSON" },
    });
    expect(
      parser.parseLine(
        JSON.stringify({
          type: "QA_HELLO",
          schemaVersion: 2,
          bridgeInstanceId: instance,
          bootId: "boot",
          buildId: "qa",
          token: "secret-value",
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "SCHEMA_VERSION_UNSUPPORTED" } });
    expect(
      parser.parseLine(
        JSON.stringify({ type: "UNRELATED_LOG", schemaVersion: 1, token: "secret-value" }),
      ),
    ).toMatchObject({ ok: false, error: { code: "MESSAGE_UNSUPPORTED" } });
    expect(diagnostics.join("\n")).not.toContain("secret-value");
    expect(diagnostics[0]?.length).toBeLessThanOrEqual(512);
  });
});
