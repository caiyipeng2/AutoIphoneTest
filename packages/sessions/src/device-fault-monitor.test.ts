import { describe, expect, it, vi } from "vitest";

import { DeviceConnectionFaultMonitor } from "./device-fault-monitor.js";

describe("DeviceConnectionFaultMonitor", () => {
  it("turns offline transitions into incidents for every matching run and ignores online events", async () => {
    let listener: ((event: DeviceConnectionEvent) => void) | undefined;
    const handle = vi.fn(async (input: DeviceFaultInput) => ({ incident: input.incident }));
    const monitor = new DeviceConnectionFaultMonitor({
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      listRuns: () => [
        {
          runId: "run-a",
          policy: "PAUSE_ALL",
          members: [
            { serial: "R5CX211TXNT", role: "LEADER", membershipState: "ACTIVE" },
            { serial: "R5CWB17PN0Y", role: "FOLLOWER", membershipState: "ACTIVE" },
          ],
        },
        {
          runId: "run-b",
          policy: "QUARANTINE_FAILED_DEVICE",
          members: [{ serial: "R5CX211TXNT", role: "LEADER", membershipState: "ACTIVE" }],
        },
      ],
      handleIncident: handle,
      nowRealtimeMs: () => 42_000,
    });
    monitor.start();

    listener?.({
      serial: "R5CX211TXNT",
      state: "ONLINE",
      connectionSeq: 3,
      observedAt: "2026-08-13T00:00:03.000Z",
    });
    expect(handle).not.toHaveBeenCalled();

    listener?.({
      serial: "R5CX211TXNT",
      state: "OFFLINE",
      connectionSeq: 4,
      observedAt: "2026-08-13T00:00:04.000Z",
    });
    await monitor.flush();

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle.mock.calls.map(([input]) => input.incident)).toEqual([
      expect.objectContaining({
        incidentId: "inc-adb-run-a-R5CX211TXNT-4",
        runId: "run-a",
        serial: "R5CX211TXNT",
        category: "ADB_DISCONNECTED",
        generation: 4,
        detectedAtRealtimeMs: 42_000,
      }),
      expect.objectContaining({ incidentId: "inc-adb-run-b-R5CX211TXNT-4", runId: "run-b" }),
    ]);
  });

  it("deduplicates a repeated connection sequence and detaches on stop", async () => {
    let listener: ((event: DeviceConnectionEvent) => void) | undefined;
    const handle = vi.fn(async (input: DeviceFaultInput) => ({ incident: input.incident }));
    const monitor = new DeviceConnectionFaultMonitor({
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      listRuns: () => [
        {
          runId: "run-a",
          policy: "PAUSE_ALL",
          members: [{ serial: "R5CX211TXNT", role: "LEADER", membershipState: "ACTIVE" }],
        },
      ],
      handleIncident: handle,
    });
    monitor.start();
    const event = {
      serial: "R5CX211TXNT",
      state: "UNAUTHORIZED" as const,
      connectionSeq: 7,
      observedAt: "2026-08-13T00:00:07.000Z",
    };
    listener?.(event);
    listener?.(event);
    await monitor.flush();
    expect(handle).toHaveBeenCalledTimes(1);

    monitor.stop();
    listener?.(event);
    await monitor.flush();
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

interface DeviceConnectionEvent {
  readonly serial: string;
  readonly state: "ONLINE" | "UNAUTHORIZED" | "OFFLINE" | "UNKNOWN";
  readonly connectionSeq: number;
  readonly observedAt: string;
}

interface DeviceFaultInput {
  readonly incident: { readonly incidentId: string };
}
