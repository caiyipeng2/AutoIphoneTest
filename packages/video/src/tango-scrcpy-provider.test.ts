import { describe, expect, it } from "vitest";

import { TangoScrcpyViewProvider } from "./tango-scrcpy-provider.js";
import type { ScrcpyVideoTransport } from "./tango-scrcpy-provider.js";

function packet(): Uint8Array {
  const metadata = Buffer.alloc(12);
  metadata.writeUInt32BE(0x68323634, 0);
  metadata.writeUInt32BE(1080, 4);
  metadata.writeUInt32BE(2340, 8);
  const header = Buffer.alloc(12);
  header.writeBigUInt64BE((1n << 62n) | 7n, 0);
  header.writeUInt32BE(4, 8);
  return new Uint8Array(Buffer.concat([metadata, header, Buffer.from([1, 2, 3, 4])]));
}

class FakeTransport implements ScrcpyVideoTransport {
  public closed = false;
  public async open(): Promise<AsyncIterable<Uint8Array>> {
    const bytes = packet();
    return (async function* () {
      yield bytes.slice(0, 9);
      yield bytes.slice(9);
      await new Promise<void>(() => undefined);
    })();
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

describe("TangoScrcpyViewProvider", () => {
  it("publishes serial-bound primary frames after the first packet", async () => {
    const transport = new FakeTransport();
    const provider = new TangoScrcpyViewProvider({
      serial: "R5CX211TXNT",
      transport,
      firstFrameTimeoutMs: 500,
    });

    await provider.start();

    expect(provider.state).toBe("READY");
    expect(provider.kind).toBe("tango");
    expect(provider.degraded).toBe(false);
    expect(provider.getLatestFrame()).toMatchObject({
      frameId: 1,
      serial: "R5CX211TXNT",
      width: 1080,
      height: 2340,
      format: "h264",
      provider: "tango",
      metricsEpoch: 1,
      keyFrame: true,
      config: false,
      presentationTimestampUs: "7",
    });

    await provider.stop();
    expect(provider.state).toBe("STOPPED");
    expect(transport.closed).toBe(true);
  });

  it("fails cleanly when the transport never delivers a first frame", async () => {
    const transport: ScrcpyVideoTransport = {
      open: async () => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>(() => undefined);
          yield new Uint8Array(0);
        },
      }),
      close: async () => undefined,
    };
    const provider = new TangoScrcpyViewProvider({
      serial: "R5CX211TXNT",
      transport,
      firstFrameTimeoutMs: 10,
    });

    await expect(provider.start()).rejects.toThrow("first H.264 frame");
    expect(provider.state).toBe("ERROR");
  });
});
