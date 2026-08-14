import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { BridgeMessage } from "@test-center/contracts/bridge";
import type { BridgeClientSnapshot } from "./bridge-client.js";

type QaPong = Extract<BridgeMessage, { type: "QA_PONG" }>;

const DEFAULT_SAMPLE_COUNT = 9;
const DEFAULT_PING_TIMEOUT_MS = 1_000;

export interface ClockCalibrationSample {
  readonly pingId: string;
  readonly hostSendMonotonicMs: number;
  readonly hostReceiveMonotonicMs: number;
  readonly deviceRealtimeMs: number;
  readonly rttMs: number;
  readonly offsetMs: number;
  readonly uncertaintyMs: number;
}

export interface ClockCalibration {
  readonly bridgeInstanceId: string;
  readonly bootId: string;
  readonly samples: readonly ClockCalibrationSample[];
  readonly selectedSample: ClockCalibrationSample;
  readonly offsetMs: number;
  readonly uncertaintyMs: number;
}

export interface ClockCalibrationClient {
  getSnapshot(): BridgeClientSnapshot;
  send(message: unknown): void;
  onMessage(listener: (message: BridgeMessage) => void): () => void;
}

export interface ClockCalibratorOptions {
  readonly sampleCount?: number;
  readonly pingTimeoutMs?: number;
  readonly nowMonotonicMs?: () => number;
  readonly createPingId?: () => string;
}

export type ClockCalibrationErrorCode =
  "BRIDGE_NOT_READY" | "PING_TIMEOUT" | "BRIDGE_CHANGED" | "INVALID_DEVICE_CLOCK";

export class ClockCalibrationError extends Error {
  public constructor(
    public readonly code: ClockCalibrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClockCalibrationError";
  }
}

export class ClockCalibrator {
  private readonly sampleCount: number;
  private readonly pingTimeoutMs: number;
  private readonly nowMonotonicMs: () => number;
  private readonly createPingId: () => string;
  private calibration: ClockCalibration | undefined;

  public constructor(
    private readonly client: ClockCalibrationClient,
    options: ClockCalibratorOptions = {},
  ) {
    this.sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
    this.pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
    this.nowMonotonicMs = options.nowMonotonicMs ?? (() => performance.now());
    this.createPingId = options.createPingId ?? randomUUID;
    if (!Number.isSafeInteger(this.sampleCount) || this.sampleCount <= 0) {
      throw new TypeError("sampleCount must be a positive safe integer.");
    }
    if (!Number.isFinite(this.pingTimeoutMs) || this.pingTimeoutMs <= 0) {
      throw new TypeError("pingTimeoutMs must be greater than zero.");
    }
  }

  public getCalibration(): ClockCalibration | undefined {
    return this.calibration;
  }

  public needsRecalibration(snapshot = this.client.getSnapshot()): boolean {
    const calibration = this.calibration;
    return (
      calibration === undefined ||
      snapshot.status !== "ready" ||
      snapshot.hello?.bridgeInstanceId !== calibration.bridgeInstanceId ||
      snapshot.hello.bootId !== calibration.bootId
    );
  }

  public async calibrate(): Promise<ClockCalibration> {
    const initial = this.client.getSnapshot();
    const identity = getReadyIdentity(initial);
    const samples: ClockCalibrationSample[] = [];
    for (let index = 0; index < this.sampleCount; index += 1) {
      samples.push(await this.collectSample(identity.bridgeInstanceId));
    }

    const final = this.client.getSnapshot();
    if (
      final.status !== "ready" ||
      final.hello?.bridgeInstanceId !== identity.bridgeInstanceId ||
      final.hello.bootId !== identity.bootId
    ) {
      throw new ClockCalibrationError(
        "BRIDGE_CHANGED",
        "Unity QA bridge instance or boot changed during clock calibration.",
      );
    }

    const selectedSample = samples.reduce((best, sample) =>
      sample.rttMs < best.rttMs ? sample : best,
    );
    const result: ClockCalibration = {
      bridgeInstanceId: identity.bridgeInstanceId,
      bootId: identity.bootId,
      samples,
      selectedSample,
      offsetMs: selectedSample.offsetMs,
      uncertaintyMs: selectedSample.uncertaintyMs,
    };
    this.calibration = result;
    return result;
  }

  private async collectSample(bridgeInstanceId: string): Promise<ClockCalibrationSample> {
    const pingId = this.createPingId();
    const hostSendMonotonicMs = this.nowMonotonicMs();
    const pongPromise = new Promise<{ message: QaPong; hostReceiveMonotonicMs: number }>(
      (resolve, reject) => {
        const listener = { remove: () => undefined as void };
        const timer = setTimeout(() => {
          listener.remove();
          reject(
            new ClockCalibrationError(
              "PING_TIMEOUT",
              `QA_PONG ${pingId} was not received before the ping timeout.`,
            ),
          );
        }, this.pingTimeoutMs);
        listener.remove = this.client.onMessage((message) => {
          if (message.type !== "QA_PONG" || message.pingId !== pingId) return;
          clearTimeout(timer);
          listener.remove();
          resolve({ message, hostReceiveMonotonicMs: this.nowMonotonicMs() });
        });
      },
    );

    try {
      this.client.send({ type: "QA_PING", schemaVersion: 1, pingId });
      const { message, hostReceiveMonotonicMs } = await pongPromise;
      if (message.bridgeInstanceId !== bridgeInstanceId) {
        throw new ClockCalibrationError(
          "BRIDGE_CHANGED",
          "QA_PONG belongs to a different Unity QA bridge instance.",
        );
      }
      const rttMs = hostReceiveMonotonicMs - hostSendMonotonicMs;
      if (!Number.isFinite(rttMs) || rttMs < 0) {
        throw new ClockCalibrationError(
          "INVALID_DEVICE_CLOCK",
          "Host monotonic clock moved backwards during clock calibration.",
        );
      }
      const deviceRealtimeMs = decimalNanosecondsToMilliseconds(message.observedAtRealtimeNs);
      const hostMidpointMs = (hostSendMonotonicMs + hostReceiveMonotonicMs) / 2;
      const uncertaintyMs = rttMs / 2;
      return {
        pingId,
        hostSendMonotonicMs,
        hostReceiveMonotonicMs,
        deviceRealtimeMs,
        rttMs,
        offsetMs: deviceRealtimeMs - hostMidpointMs,
        uncertaintyMs,
      };
    } catch (error) {
      if (error instanceof ClockCalibrationError) throw error;
      throw new ClockCalibrationError(
        "BRIDGE_NOT_READY",
        "Unable to send a clock calibration ping.",
        {
          cause: error,
        },
      );
    }
  }
}

function getReadyIdentity(snapshot: BridgeClientSnapshot): {
  bridgeInstanceId: string;
  bootId: string;
} {
  if (snapshot.status !== "ready" || snapshot.hello === undefined) {
    throw new ClockCalibrationError(
      "BRIDGE_NOT_READY",
      "Clock calibration requires a ready Unity QA bridge handshake.",
    );
  }
  return {
    bridgeInstanceId: snapshot.hello.bridgeInstanceId,
    bootId: snapshot.hello.bootId,
  };
}

function decimalNanosecondsToMilliseconds(value: string): number {
  try {
    const nanoseconds = BigInt(value);
    const milliseconds = Number(nanoseconds) / 1_000_000;
    if (!Number.isSafeInteger(Number(nanoseconds)) && !Number.isFinite(milliseconds)) {
      throw new Error("device clock is outside the supported range");
    }
    return milliseconds;
  } catch (error) {
    throw new ClockCalibrationError("INVALID_DEVICE_CLOCK", "QA_PONG device realtime is invalid.", {
      cause: error,
    });
  }
}
