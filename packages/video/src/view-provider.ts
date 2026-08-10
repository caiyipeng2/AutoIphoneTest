import type { DeviceSerial } from "@test-center/contracts/device";

import type { EncodedFrame } from "./latest-frame-buffer.js";

export type ViewProviderKind = "tango" | "mjpeg" | "screenshot";
export type ViewProviderState = "STOPPED" | "STARTING" | "READY" | "DEGRADED" | "ERROR";

export interface ViewProvider {
  readonly serial: DeviceSerial;
  readonly kind: ViewProviderKind;
  readonly degraded: boolean;
  readonly state: ViewProviderState;
  start(): Promise<void>;
  stop(): Promise<void>;
  captureOnce(): Promise<EncodedFrame>;
  getLatestFrame(): EncodedFrame | undefined;
  subscribe(listener: (frame: EncodedFrame) => void): () => void;
}
