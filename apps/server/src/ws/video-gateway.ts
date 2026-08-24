import type { FastifyInstance, FastifyRequest } from "fastify";

import { parseDeviceSerial } from "@test-center/contracts/device";
import type { EncodedFrame, ViewProvider } from "@test-center/video";
import { assertAllowedHost, assertSameOrigin } from "@test-center/security/request-policy";

import { requireSession } from "../routes/bootstrap.js";
import type { ServerContext } from "../routes/context.js";

const MAX_JSON_FRAME_BYTES = 12 * 1024 * 1024;

interface VideoSocket {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  on?(event: "close", listener: () => void): void;
}

export interface VideoFrameMessage {
  readonly type: "video.frame";
  readonly frame: {
    readonly schemaVersion: 1;
    readonly frameId: number;
    readonly serial: string;
    readonly capturedAtMonotonicMs: number;
    readonly metricsEpoch: number;
    readonly width: number;
    readonly height: number;
    readonly format: EncodedFrame["format"];
    readonly keyFrame?: boolean;
    readonly config?: boolean;
    readonly presentationTimestampUs?: string;
    readonly degraded: boolean;
    readonly provider: EncodedFrame["provider"];
    readonly degradedReason?: EncodedFrame["degradedReason"];
    readonly dataBase64: string;
  };
}

export function encodeVideoFrame(frame: EncodedFrame): VideoFrameMessage {
  const dataBase64 = Buffer.from(frame.data).toString("base64");
  const message: VideoFrameMessage = {
    type: "video.frame",
    frame: {
      schemaVersion: 1,
      frameId: frame.frameId,
      serial: frame.serial,
      capturedAtMonotonicMs: frame.capturedAtMonotonicMs,
      metricsEpoch: frame.metricsEpoch,
      width: frame.width,
      height: frame.height,
      format: frame.format,
      ...(frame.keyFrame === undefined ? {} : { keyFrame: frame.keyFrame }),
      ...(frame.config === undefined ? {} : { config: frame.config }),
      ...(frame.presentationTimestampUs === undefined
        ? {}
        : { presentationTimestampUs: frame.presentationTimestampUs }),
      degraded: frame.degraded,
      provider: frame.provider,
      ...(frame.degradedReason === undefined ? {} : { degradedReason: frame.degradedReason }),
      dataBase64,
    },
  };
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_JSON_FRAME_BYTES) {
    throw new RangeError("Video frame exceeds the gateway payload limit.");
  }
  return message;
}

export async function openVideoProvider(
  provider: ViewProvider,
  onFrame: (frame: EncodedFrame) => void,
): Promise<() => void> {
  await provider.start();
  const latest = provider.getLatestFrame();
  if (latest !== undefined) onFrame(latest);
  return provider.subscribe(onFrame);
}

export async function registerVideoGateway(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{ Params: { serial: string } }>(
    "/ws/video/:serial",
    { websocket: true },
    (socket: VideoSocket, request: FastifyRequest<{ Params: { serial: string } }>) => {
      let unsubscribe: (() => void) | undefined;
      void (async () => {
        try {
          assertAllowedHost(request.headers.host, context.port);
          assertSameOrigin(request.headers.origin, context.port);
          if (requireSession(request, context) === undefined) {
            throw new TypeError("Authentication required.");
          }
          const serial = parseDeviceSerial(decodeURIComponent(request.params.serial));
          const provider = context.views?.get(serial);
          if (provider === undefined || provider.serial !== serial) {
            throw new TypeError("Video provider is unavailable for this serial.");
          }
          const sendFrame = (frame: EncodedFrame): void => {
            try {
              socket.send(JSON.stringify(encodeVideoFrame(frame)));
            } catch {
              socket.close(1011, "Video frame could not be encoded.");
            }
          };
          unsubscribe = await openVideoProvider(provider, sendFrame);
          socket.on?.("close", () => unsubscribe?.());
        } catch {
          unsubscribe?.();
          socket.close(1008, "Unauthorized or unavailable video stream.");
        }
      })();
    },
  );
}
