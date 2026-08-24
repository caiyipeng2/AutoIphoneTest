import { describe, expect, it, vi } from "vitest";

import { encodeVideoFrame, openVideoProvider } from "./video-gateway.js";

describe("video gateway frame encoding", () => {
  it("encodes bounded frame metadata and payload without exposing mutable buffers", () => {
    const frame = {
      schemaVersion: 1 as const,
      frameId: 7,
      serial: "serial-a",
      capturedAtMonotonicMs: 1234,
      metricsEpoch: 2,
      width: 1080,
      height: 2340,
      format: "jpeg" as const,
      data: new Uint8Array([1, 2, 3]),
      degraded: true,
      provider: "screenshot" as const,
      degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE" as const,
    };

    const encoded = encodeVideoFrame(frame);

    expect(encoded).toEqual({
      type: "video.frame",
      frame: {
        schemaVersion: 1,
        frameId: 7,
        serial: "serial-a",
        capturedAtMonotonicMs: 1234,
        metricsEpoch: 2,
        width: 1080,
        height: 2340,
        format: "jpeg",
        degraded: true,
        provider: "screenshot",
        degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
        dataBase64: "AQID",
      },
    });
    frame.data[0] = 9;
    expect(encoded.frame.dataBase64).toBe("AQID");
  });
});

describe("video gateway provider startup", () => {
  it("starts the provider before sending its first frame and subscribing", async () => {
    const calls: string[] = [];
    const frame = {
      schemaVersion: 1 as const,
      frameId: 1,
      serial: "serial-a",
      capturedAtMonotonicMs: 1,
      metricsEpoch: 1,
      width: 2,
      height: 2,
      format: "h264" as const,
      data: new Uint8Array([1]),
      keyFrame: true,
      config: false,
      presentationTimestampUs: "1",
      degraded: false,
      provider: "tango" as const,
    };
    let started = false;
    const unsubscribe = vi.fn();
    const provider = {
      start: vi.fn(async () => {
        calls.push("start");
        started = true;
      }),
      getLatestFrame: vi.fn(() => (started ? frame : undefined)),
      subscribe: vi.fn(() => {
        calls.push("subscribe");
        return unsubscribe;
      }),
    } as never;

    const cleanup = await openVideoProvider(provider, () => calls.push("send"));

    expect(calls).toEqual(["start", "send", "subscribe"]);
    expect(cleanup).toBe(unsubscribe);
  });
});
