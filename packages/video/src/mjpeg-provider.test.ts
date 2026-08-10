import { describe, expect, it, vi } from "vitest";

import { MjpegViewProvider } from "./mjpeg-provider.js";

describe("MjpegViewProvider", () => {
  it("captures a serial-bound screenshot and reports a degraded fallback frame", async () => {
    const provider = new MjpegViewProvider({
      serial: "serial-a",
      captureScreenshot: vi.fn(async () => ({ base64: "AQID", width: 1080, height: 2400 })),
      now: () => 123,
    });

    const frame = await provider.captureOnce();

    expect(frame).toMatchObject({
      frameId: 1,
      serial: "serial-a",
      capturedAtMonotonicMs: 123,
      width: 1080,
      height: 2400,
      format: "jpeg",
      degraded: true,
      provider: "screenshot",
      degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
    });
    expect([...frame.data]).toEqual([1, 2, 3]);
  });

  it("never captures faster than the configured two FPS ceiling", async () => {
    let now = 0;
    const capture = vi.fn(async () => ({ base64: "AA==", width: 1, height: 1 }));
    const provider = new MjpegViewProvider({
      serial: "serial-a",
      captureScreenshot: capture,
      now: () => now,
      minCaptureIntervalMs: 500,
    });

    await provider.captureOnce();
    now = 100;
    await expect(provider.captureOnce()).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    now = 500;
    await provider.captureOnce();

    expect(capture).toHaveBeenCalledTimes(2);
  });
});
