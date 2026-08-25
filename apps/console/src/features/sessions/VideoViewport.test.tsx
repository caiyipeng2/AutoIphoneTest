// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoViewport } from "./VideoViewport";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public readonly url: string;

  public constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  public close(): void {
    this.onclose?.();
  }

  public emitOpen(): void {
    this.onopen?.();
  }

  public emitMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe("VideoViewport", () => {
  it("keeps the socket open for screenshot fallback without H.264 support", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("VideoDecoder", undefined);
    vi.stubGlobal("EncodedVideoChunk", undefined);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn() })),
    );
    const context = { drawImage: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );

    render(<VideoViewport serial="R5CX211TXNT" />);

    expect(screen.getByRole("status")).toHaveTextContent("正在建立降级截图通道");
    const socket = FakeWebSocket.instances[0]!;
    socket.emitOpen();
    socket.emitMessage({
      type: "video.frame",
      frame: {
        schemaVersion: 1,
        frameId: 1,
        serial: "R5CX211TXNT",
        capturedAtMonotonicMs: 12,
        metricsEpoch: 1,
        width: 1080,
        height: 2340,
        format: "jpeg",
        degraded: true,
        provider: "screenshot",
        degradedReason: "PRIMARY_PROVIDER_UNAVAILABLE",
        dataBase64: "AQID",
      },
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("降级截图"));
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });

  it("reports a recoverable browser capability error when an H.264 frame arrives", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("VideoDecoder", undefined);
    vi.stubGlobal("EncodedVideoChunk", undefined);

    render(<VideoViewport serial="R5CX211TXNT" />);

    const socket = FakeWebSocket.instances[0]!;
    socket.emitMessage({
      type: "video.frame",
      frame: {
        schemaVersion: 1,
        frameId: 1,
        serial: "R5CX211TXNT",
        capturedAtMonotonicMs: 12,
        metricsEpoch: 1,
        width: 1080,
        height: 2340,
        format: "h264",
        degraded: false,
        provider: "tango",
        keyFrame: true,
        config: false,
        presentationTimestampUs: "42",
        dataBase64: "AQID",
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("浏览器不支持 H.264 解码"),
    );
    expect(screen.getByRole("button", { name: "重试主视图" })).toBeInTheDocument();
  });

  it("opens the exact serial stream and publishes fixed frame geometry", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "VideoDecoder",
      class FakeVideoDecoder {
        public static isConfigSupported = async () => ({ supported: true });
        private readonly output: (frame: { close: () => void }) => void;
        public constructor(callbacks: { output: (frame: { close: () => void }) => void }) {
          this.output = callbacks.output;
        }
        public configure(): void {}
        public decode(): void {
          this.output({ close: () => undefined });
        }
        public close(): void {}
      },
    );
    vi.stubGlobal(
      "EncodedVideoChunk",
      class {
        public constructor() {}
      },
    );
    const context = { drawImage: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );

    render(<VideoViewport serial="R5CX211TXNT" />);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toContain("/ws/video/R5CX211TXNT");
    socket.emitOpen();
    socket.emitMessage({
      type: "video.frame",
      frame: {
        schemaVersion: 1,
        frameId: 1,
        serial: "R5CX211TXNT",
        capturedAtMonotonicMs: 12,
        metricsEpoch: 1,
        width: 1080,
        height: 2340,
        format: "h264",
        degraded: false,
        provider: "tango",
        keyFrame: true,
        config: false,
        presentationTimestampUs: "42",
        dataBase64: "AQID",
      },
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("主视图 · 1080×2340"));
    const canvas = screen.getByRole("img", { name: "设备主视图" });
    expect(canvas).toHaveAttribute("width", "1080");
    expect(canvas).toHaveAttribute("height", "2340");
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
});
