import { describe, expect, it, vi } from "vitest";

import { ActionDispatcher } from "./action-dispatcher.js";

describe("ActionDispatcher bridge mode", () => {
  it("does not arm a Unity bridge for an explicit Appium-only action", async () => {
    const barrierFactory = vi.fn(async () => ({
      waitForAck: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    }));
    const executor = vi.fn(async () => ({ executed: true }));
    const repository = {
      get: vi.fn(() => ({
        id: "act-1",
        runId: "run-1",
        clientRequestId: "request-1",
        actionSeq: 1,
        type: "tap" as const,
        command: { type: "tap" as const, x: 0.5, y: 0.5 },
        payload: { kind: "tap" as const, x: 0.5, y: 0.5 },
        sourceMetricsEpoch: 1,
        state: "QUEUED" as const,
        targets: [{ serial: "R5CX211TXNT", state: "QUEUED" as const }],
      })),
    };
    const outbox = {
      leaseAction: vi.fn(() => ({ leaseToken: "lease-1" })),
      markDispatching: vi.fn(),
      completeTarget: vi.fn(),
    };
    const dispatcher = new ActionDispatcher(
      repository as never,
      outbox as never,
      () => ({ execute: executor }),
      "dispatcher-test",
      barrierFactory as never,
    );

    await dispatcher.dispatch({
      actionId: "act-1",
      packageName: "com.example.game",
      bridgeMode: "APPIUM_ONLY",
    });

    expect(barrierFactory).not.toHaveBeenCalled();
    expect(executor).toHaveBeenCalledOnce();
    expect(outbox.completeTarget).toHaveBeenCalledWith(
      "act-1",
      "lease-1",
      "R5CX211TXNT",
      "SUCCEEDED",
      expect.stringContaining('"ok":true'),
    );
  });
});
