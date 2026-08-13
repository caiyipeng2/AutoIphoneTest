import { describe, expect, it, vi } from "vitest";

import { TextFocusBarrier, TextFocusBarrierError } from "./text-focus-barrier.js";

const base = (
  serial: string,
  overrides: Partial<{
    focusedControlId: string | null;
    view: string;
    metricsEpoch: number;
    bridgeInstanceId: string;
  }> = {},
) => ({
  serial,
  bridgeInstanceId: overrides.bridgeInstanceId ?? "bridge-a",
  view: overrides.view ?? "MainHUD",
  focusedControlId:
    overrides.focusedControlId === undefined ? "shop-name" : overrides.focusedControlId,
  metricsEpoch: overrides.metricsEpoch ?? 4,
});

describe("TextFocusBarrier", () => {
  it("requires every target to share trusted focus, view, bridge, and metrics twice", async () => {
    const provider = { sample: vi.fn(async (serial: string) => base(serial)) };
    await new TextFocusBarrier(provider, { settleMs: 0 }).verify({
      serials: ["leader-a", "follower-b"],
      metricsEpoch: 4,
    });
    expect(provider.sample).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["missing focus", base("follower-b", { focusedControlId: null }), "MISSING_FOCUS"],
    ["different focus", base("follower-b", { focusedControlId: "other" }), "FOCUS_MISMATCH"],
    ["different view", base("follower-b", { view: "Shop" }), "VIEW_MISMATCH"],
    ["missing bridge", base("follower-b", { bridgeInstanceId: "" }), "BRIDGE_MISMATCH"],
    ["different metrics", base("follower-b", { metricsEpoch: 5 }), "METRICS_CHANGED"],
  ] as const)("rejects %s before any text dispatch", async (_label, follower, code) => {
    const provider = {
      sample: vi.fn(async (serial: string) => (serial === "leader-a" ? base(serial) : follower)),
    };
    await expect(
      new TextFocusBarrier(provider, { settleMs: 0 }).verify({
        serials: ["leader-a", "follower-b"],
        metricsEpoch: 4,
      }),
    ).rejects.toMatchObject({
      code,
    } satisfies Partial<TextFocusBarrierError>);
  });

  it("rejects a focus change between the two samples", async () => {
    let sampleCount = 0;
    const provider = {
      sample: vi.fn(async (serial: string) => {
        sampleCount += 1;
        return base(serial, {
          focusedControlId: sampleCount > 1 && serial === "leader-a" ? "changed" : "shop-name",
        });
      }),
    };
    await expect(
      new TextFocusBarrier(provider, { settleMs: 0 }).verify({
        serials: ["leader-a"],
        metricsEpoch: 4,
      }),
    ).rejects.toMatchObject({ code: "SAMPLE_CHANGED" });
  });

  it("allows independent bridge instances when each device is stable", async () => {
    const provider = {
      sample: vi.fn(async (serial: string) =>
        base(serial, { bridgeInstanceId: serial === "leader-a" ? "bridge-a" : "bridge-b" }),
      ),
    };
    await new TextFocusBarrier(provider, { settleMs: 0 }).verify({
      serials: ["leader-a", "follower-b"],
      metricsEpoch: 4,
    });
  });
});
