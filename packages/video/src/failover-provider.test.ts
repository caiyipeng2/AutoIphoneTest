import { describe, expect, it, vi } from "vitest";

import type { DeviceSerial } from "@test-center/contracts/device";

import type { EncodedFrame } from "./latest-frame-buffer.js";
import { FailoverViewProvider } from "./failover-provider.js";
import type { ViewProvider, ViewProviderState } from "./view-provider.js";

const serial = "R5CX211TXNT" as DeviceSerial;

function createProvider(
  kind: ViewProvider["kind"],
  startError?: Error,
): ViewProvider & {
  readonly start: ReturnType<typeof vi.fn>;
  readonly stop: ReturnType<typeof vi.fn>;
} {
  let state: ViewProviderState = "STOPPED";
  const frame: EncodedFrame =
    kind === "tango"
      ? {
          schemaVersion: 1,
          frameId: 1,
          serial,
          capturedAtMonotonicMs: 123,
          metricsEpoch: 1,
          width: 1080,
          height: 2340,
          format: "h264",
          data: new Uint8Array([1, 2, 3]),
          keyFrame: true,
          config: false,
          presentationTimestampUs: "1",
          degraded: false,
          provider: "tango",
        }
      : {
          schemaVersion: 1,
          frameId: 2,
          serial,
          capturedAtMonotonicMs: 123,
          metricsEpoch: 1,
          width: 1080,
          height: 2340,
          format: "jpeg",
          data: new Uint8Array([1, 2, 3]),
          degraded: true,
          provider: "screenshot",
          degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
        };
  const provider = {
    serial,
    kind,
    degraded: kind !== "tango",
    get state() {
      return state;
    },
    start: vi.fn(async () => {
      if (startError !== undefined) {
        state = "ERROR";
        throw startError;
      }
      state = kind === "screenshot" ? "DEGRADED" : "READY";
    }),
    stop: vi.fn(async () => {
      state = "STOPPED";
    }),
    captureOnce: vi.fn(async () => frame),
    getLatestFrame: vi.fn(() => frame),
    subscribe: vi.fn(() => () => undefined),
  } satisfies ViewProvider;
  return provider;
}

describe("FailoverViewProvider", () => {
  it("keeps the primary provider when it starts successfully", async () => {
    const primary = createProvider("tango");
    const fallback = createProvider("screenshot");
    const provider = new FailoverViewProvider({ serial, primary, fallback });

    await provider.start();

    expect(provider.kind).toBe("tango");
    expect(provider.degraded).toBe(false);
    expect(provider.state).toBe("READY");
    expect(primary.start).toHaveBeenCalledOnce();
    expect(fallback.start).not.toHaveBeenCalled();

    await provider.stop();
    expect(primary.stop).toHaveBeenCalledOnce();
    expect(fallback.stop).not.toHaveBeenCalled();
  });

  it("starts the degraded screenshot provider after the primary fails", async () => {
    const primary = createProvider("tango", new Error("scrcpy unavailable"));
    const fallback = createProvider("screenshot");
    const provider = new FailoverViewProvider({ serial, primary, fallback });

    await provider.start();

    expect(provider.kind).toBe("screenshot");
    expect(provider.degraded).toBe(true);
    expect(provider.state).toBe("DEGRADED");
    expect(primary.start).toHaveBeenCalledOnce();
    expect(primary.stop).toHaveBeenCalledOnce();
    expect(fallback.start).toHaveBeenCalledOnce();
    await expect(provider.captureOnce()).resolves.toMatchObject({ provider: "screenshot" });

    await provider.stop();
    expect(fallback.stop).toHaveBeenCalledOnce();
  });

  it("reports a combined startup error when both providers fail", async () => {
    const primary = createProvider("tango", new Error("scrcpy unavailable"));
    const fallback = createProvider("screenshot", new Error("Appium unavailable"));
    const provider = new FailoverViewProvider({ serial, primary, fallback });

    await expect(provider.start()).rejects.toThrow("Primary and screenshot fallback providers");
    expect(provider.state).toBe("ERROR");
    expect(primary.stop).toHaveBeenCalledOnce();
    expect(fallback.stop).toHaveBeenCalledOnce();
  });
});
