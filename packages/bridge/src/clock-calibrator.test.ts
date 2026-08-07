import { describe, expect, it } from "vitest";

import type { BridgeMessage } from "@test-center/contracts/bridge";
import {
  ClockCalibrationError,
  ClockCalibrator,
  type ClockCalibrationClient,
} from "./clock-calibrator.js";

const bridgeInstanceId = "bridge-instance-a";
const bootId = "boot-1";

class FakeClockClient implements ClockCalibrationClient {
  public snapshot: ClockCalibrationClient["getSnapshot"] extends () => infer T ? T : never = {
    status: "ready",
    hello: {
      type: "QA_HELLO",
      schemaVersion: 1,
      bridgeInstanceId,
      bootId,
      buildId: "qa-1",
    },
  };
  public readonly sent: unknown[] = [];
  public pongByPingId = new Map<string, string>();
  public changeIdentityOnSend = false;
  private readonly listeners = new Set<(message: BridgeMessage) => void>();

  public getSnapshot(): ClockCalibrationClient["getSnapshot"] extends () => infer T ? T : never {
    return this.snapshot;
  }

  public send(message: unknown): void {
    this.sent.push(message);
    const pingId = (message as { pingId: string }).pingId;
    if (this.changeIdentityOnSend) {
      this.snapshot = {
        ...this.snapshot,
        hello: { ...this.snapshot.hello!, bridgeInstanceId: "bridge-instance-b", bootId: "boot-2" },
      };
      this.changeIdentityOnSend = false;
    }
    const observedAtRealtimeNs = this.pongByPingId.get(pingId);
    if (observedAtRealtimeNs === undefined) return;
    const pong: BridgeMessage = {
      type: "QA_PONG",
      schemaVersion: 1,
      bridgeInstanceId,
      pingId,
      observedAtRealtimeNs,
    };
    this.listeners.forEach((listener) => listener(pong));
  }

  public onMessage(listener: (message: BridgeMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function createClockValues(): number[] {
  return [100, 104, 200, 202, 300, 308, 400, 406, 500, 506, 600, 604, 700, 710, 800, 804, 900, 906];
}

describe("ClockCalibrator", () => {
  it("takes nine samples and selects the minimum RTT with half-RTT uncertainty", async () => {
    const client = new FakeClockClient();
    const clockValues = createClockValues();
    const offsets = [25, 25, 25, 25, 25, 25, 25, 25, 25];
    let index = 0;
    const calibrator = new ClockCalibrator(client, {
      nowMonotonicMs: () => clockValues[index++]!,
      createPingId: (() => {
        let ping = 0;
        return () => `ping-${++ping}`;
      })(),
    });

    for (let sample = 0; sample < offsets.length; sample += 1) {
      const midpoint = (clockValues[sample * 2]! + clockValues[sample * 2 + 1]!) / 2;
      client.pongByPingId.set(
        `ping-${sample + 1}`,
        String(Math.round((midpoint + offsets[sample]!) * 1_000_000)),
      );
    }

    const calibration = await calibrator.calibrate();

    expect(client.sent).toHaveLength(9);
    expect(calibration.samples).toHaveLength(9);
    expect(calibration.selectedSample.rttMs).toBe(2);
    expect(calibration.uncertaintyMs).toBe(1);
    expect(calibration.offsetMs).toBe(25);
    expect(calibrator.needsRecalibration()).toBe(false);
  });

  it("requires a ready handshake and invalidates calibration after identity changes", async () => {
    const client = new FakeClockClient();
    client.snapshot = { status: "connecting" };
    const calibrator = new ClockCalibrator(client, { pingTimeoutMs: 1 });
    await expect(calibrator.calibrate()).rejects.toMatchObject({
      code: "BRIDGE_NOT_READY",
    });

    client.snapshot = {
      status: "ready",
      hello: {
        type: "QA_HELLO",
        schemaVersion: 1,
        bridgeInstanceId,
        bootId,
        buildId: "qa-1",
      },
    };
    const values = createClockValues();
    let index = 0;
    const readyCalibrator = new ClockCalibrator(client, {
      nowMonotonicMs: () => values[index++]!,
      createPingId: (() => {
        let ping = 0;
        return () => `ready-ping-${++ping}`;
      })(),
      pingTimeoutMs: 10,
    });
    for (let sample = 0; sample < 9; sample += 1) {
      const midpoint = (values[sample * 2]! + values[sample * 2 + 1]!) / 2;
      client.pongByPingId.set(
        `ready-ping-${sample + 1}`,
        String(Math.round((midpoint + 10) * 1_000_000)),
      );
    }
    await readyCalibrator.calibrate();
    client.snapshot = {
      ...client.snapshot,
      hello: { ...client.snapshot.hello!, bridgeInstanceId: "bridge-instance-b", bootId: "boot-2" },
    };
    expect(readyCalibrator.needsRecalibration()).toBe(true);
  });

  it("rejects when a ping receives no pong before the timeout", async () => {
    const client = new FakeClockClient();
    const calibrator = new ClockCalibrator(client, {
      pingTimeoutMs: 1,
      sampleCount: 1,
      nowMonotonicMs: () => 1,
    });
    await expect(calibrator.calibrate()).rejects.toBeInstanceOf(ClockCalibrationError);
    await expect(calibrator.calibrate()).rejects.toMatchObject({ code: "PING_TIMEOUT" });
  });
});
