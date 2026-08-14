export type CaptureConnection = "CONNECTED" | "DISCONNECTED";
export type CaptureBridgeState = "READY" | "UNAVAILABLE";
export type CaptureState = "READY" | "MISSING" | "FAILED" | "UNAVAILABLE";
export type CaptureUnavailableReason =
  "DEVICE_DISCONNECTED" | "PROCESS_ABSENT" | "SOURCE_NOT_APPLICABLE" | "CAPTURE_ERROR";

export type CaptureKind =
  | "CURRENT_SCREENSHOT"
  | "FOREGROUND_PROCESS"
  | "REDACTED_LOGCAT"
  | "MAPPED_INPUT"
  | "APPIUM_TIMING"
  | "BRIDGE_STATE"
  | "BRIDGE_ARM"
  | "BRIDGE_ACK"
  | "BUFFERED_LOGCAT";

export interface CaptureEvidence {
  readonly kind: CaptureKind;
  readonly state: CaptureState;
  readonly unavailableReason?: CaptureUnavailableReason;
}

export interface MandatoryCaptureInput {
  connection: CaptureConnection;
  bridge: CaptureBridgeState;
  evidence: CaptureEvidence[];
}

export interface MandatoryCaptureResult {
  readonly passed: boolean;
  readonly items: readonly CaptureEvidence[];
  readonly missing: readonly CaptureKind[];
  readonly failed: readonly CaptureKind[];
  readonly unavailable: readonly CaptureKind[];
}

const CONNECTED_BASE: readonly CaptureKind[] = [
  "CURRENT_SCREENSHOT",
  "FOREGROUND_PROCESS",
  "REDACTED_LOGCAT",
  "MAPPED_INPUT",
  "APPIUM_TIMING",
];
const BRIDGE_EVIDENCE: readonly CaptureKind[] = ["BRIDGE_STATE", "BRIDGE_ARM", "BRIDGE_ACK"];
const DISCONNECTED_LIVE: readonly CaptureKind[] = [
  "CURRENT_SCREENSHOT",
  "FOREGROUND_PROCESS",
  "REDACTED_LOGCAT",
  "APPIUM_TIMING",
];
const ALLOWED_UNAVAILABLE: readonly CaptureUnavailableReason[] = [
  "DEVICE_DISCONNECTED",
  "PROCESS_ABSENT",
  "SOURCE_NOT_APPLICABLE",
];

/**
 * Evaluates only the evidence gate. Capture and persistence stay outside this pure rule so
 * finalization can reuse the same result for connected and disconnected runs.
 */
export function evaluateMandatoryCapture(input: MandatoryCaptureInput): MandatoryCaptureResult {
  const required: CaptureKind[] =
    input.connection === "DISCONNECTED"
      ? ["BUFFERED_LOGCAT", "MAPPED_INPUT", ...DISCONNECTED_LIVE]
      : [...CONNECTED_BASE, ...(input.bridge === "READY" ? BRIDGE_EVIDENCE : [])];
  const byKind = new Map(input.evidence.map((item) => [item.kind, item]));
  const items: CaptureEvidence[] = required.map((kind) => {
    const existing = byKind.get(kind);
    return existing ?? { kind, state: "MISSING" };
  });
  const missing: CaptureKind[] = [];
  const failed: CaptureKind[] = [];
  const unavailable: CaptureKind[] = [];

  for (const item of items) {
    if (item.state === "READY") continue;
    if (item.state === "MISSING") {
      missing.push(item.kind);
      continue;
    }
    if (
      input.connection === "DISCONNECTED" &&
      DISCONNECTED_LIVE.includes(item.kind) &&
      item.state === "UNAVAILABLE" &&
      item.unavailableReason !== undefined &&
      ALLOWED_UNAVAILABLE.includes(item.unavailableReason)
    ) {
      unavailable.push(item.kind);
      continue;
    }
    failed.push(item.kind);
  }

  return {
    passed: missing.length === 0 && failed.length === 0,
    items,
    missing,
    failed,
    unavailable,
  };
}
