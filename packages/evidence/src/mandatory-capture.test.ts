import { describe, expect, it } from "vitest";

import {
  evaluateMandatoryCapture,
  type CaptureEvidence,
  type MandatoryCaptureInput,
} from "./mandatory-capture.js";

function evidence(
  kind: CaptureEvidence["kind"],
  state: CaptureEvidence["state"],
  unavailableReason?: CaptureEvidence["unavailableReason"],
): CaptureEvidence {
  return {
    kind,
    state,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

function connectedFailure(
  overrides: Partial<Record<CaptureEvidence["kind"], CaptureEvidence>> = {},
): MandatoryCaptureInput {
  return {
    connection: "CONNECTED",
    bridge: "UNAVAILABLE",
    evidence: [
      evidence("CURRENT_SCREENSHOT", "READY"),
      evidence("FOREGROUND_PROCESS", "READY"),
      evidence("REDACTED_LOGCAT", "READY"),
      evidence("MAPPED_INPUT", "READY"),
      evidence("APPIUM_TIMING", "READY"),
      ...Object.values(overrides),
    ],
  };
}

describe("mandatory capture matrix", () => {
  it("passes connected failures when every base capture is ready", () => {
    const result = evaluateMandatoryCapture(connectedFailure());

    expect(result).toEqual({
      passed: true,
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "CURRENT_SCREENSHOT", state: "READY" }),
        expect.objectContaining({ kind: "APPIUM_TIMING", state: "READY" }),
      ]),
      missing: [],
      failed: [],
      unavailable: [],
    });
  });

  it("requires the bridge state, arm, and ACK when the bridge was ready", () => {
    const input = connectedFailure();
    input.bridge = "READY";
    input.evidence.push(
      evidence("BRIDGE_STATE", "READY"),
      evidence("BRIDGE_ARM", "READY"),
      evidence("BRIDGE_ACK", "READY"),
    );

    expect(evaluateMandatoryCapture(input).passed).toBe(true);
  });

  it("reports a missing screenshot instead of treating a generic capture failure as unavailable", () => {
    const result = evaluateMandatoryCapture(
      connectedFailure({ CURRENT_SCREENSHOT: evidence("CURRENT_SCREENSHOT", "MISSING") }),
    );

    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(["CURRENT_SCREENSHOT"]);
    expect(result.failed).toEqual([]);
    expect(result.unavailable).toEqual([]);
  });

  it("fails when an evidence capture failed with a generic error", () => {
    const result = evaluateMandatoryCapture(
      connectedFailure({ REDACTED_LOGCAT: evidence("REDACTED_LOGCAT", "FAILED") }),
    );

    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(["REDACTED_LOGCAT"]);
  });

  it("accepts disconnected live-capture gaps only with an allowed reason and buffered logs", () => {
    const result = evaluateMandatoryCapture({
      connection: "DISCONNECTED",
      bridge: "UNAVAILABLE",
      evidence: [
        evidence("BUFFERED_LOGCAT", "READY"),
        evidence("MAPPED_INPUT", "READY"),
        evidence("CURRENT_SCREENSHOT", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
        evidence("FOREGROUND_PROCESS", "UNAVAILABLE", "PROCESS_ABSENT"),
        evidence("REDACTED_LOGCAT", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
        evidence("APPIUM_TIMING", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.unavailable).toEqual([
      "CURRENT_SCREENSHOT",
      "FOREGROUND_PROCESS",
      "REDACTED_LOGCAT",
      "APPIUM_TIMING",
    ]);
  });

  it("rejects disconnected captures without an explicit allowed unavailable reason", () => {
    const result = evaluateMandatoryCapture({
      connection: "DISCONNECTED",
      bridge: "UNAVAILABLE",
      evidence: [
        evidence("BUFFERED_LOGCAT", "READY"),
        evidence("MAPPED_INPUT", "READY"),
        evidence("CURRENT_SCREENSHOT", "UNAVAILABLE", "CAPTURE_ERROR"),
        evidence("FOREGROUND_PROCESS", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
        evidence("REDACTED_LOGCAT", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
        evidence("APPIUM_TIMING", "UNAVAILABLE", "DEVICE_DISCONNECTED"),
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failed).toEqual(["CURRENT_SCREENSHOT"]);
  });
});
