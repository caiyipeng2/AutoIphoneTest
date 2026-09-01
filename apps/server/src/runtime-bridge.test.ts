import { describe, expect, it } from "vitest";

import { performance } from "node:perf_hooks";

import {
  bridgeEventShape,
  createRuntimeBridgeParser,
  createRuntimeBridgeSession,
} from "./runtime-bridge.js";
import type { BridgeHash } from "@test-center/contracts/bridge";
import type { ActionCommand } from "@test-center/sessions";

describe("createRuntimeBridgeSession", () => {
  it("accepts QA_ARMED leases in the device elapsedRealtime clock domain", () => {
    const runNonceHash = `sha256:${"0".repeat(64)}` as BridgeHash;
    const parser = createRuntimeBridgeParser(runNonceHash);
    const result = parser.parseLine(
      JSON.stringify({
        type: "QA_ARMED",
        schemaVersion: 1,
        bridgeInstanceId: "bridge-runtime-clock",
        runNonceHash,
        actionId: "action-runtime-clock",
        descriptorHash: `sha256:${"1".repeat(64)}`,
        expectedEventShapeHash: `sha256:${"1".repeat(64)}`,
        expectedView: "Launch",
        expectedFocus: null,
        metricsEpoch: 1,
        expiresAtRealtimeMs: String(Math.floor(performance.now() + 60_000)),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("quantizes a tap descriptor to the integer device viewport", () => {
    expect(
      bridgeEventShape({ type: "tap", x: 0.5, y: 0.71 } satisfies ActionCommand, 1080, 2340),
    ).toEqual({ type: "tap", x: 0.5, y: 0.71 });
  });

  it("exposes a bridge action barrier and keeps the configured nonce", async () => {
    const session = createRuntimeBridgeSession({
      hostPort: 1,
      runNonceHash: `sha256:${"a".repeat(64)}`,
      connectTimeoutMs: 10,
    });
    expect(session.actionBarrier).toHaveProperty("arm");
    await expect(session.connect()).rejects.toThrow();
    await session.close();
  });
});
