import { describe, expect, it, vi } from "vitest";

import { parseLogcatLine } from "@test-center/adb";
import { LogcatFaultMonitor } from "./logcat-fault-monitor.js";

describe("LogcatFaultMonitor", () => {
  it("turns AndroidRuntime fatal exceptions and ActivityManager ANR lines into incidents", async () => {
    let listener: ((record: ReturnType<typeof parseLogcatLine>) => void) | undefined;
    const handleIncident = vi.fn(async (input: { incident: { category: string } }) => input);
    const monitor = new LogcatFaultMonitor({
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      listRuns: () => [
        {
          runId: "run-a",
          serial: "R5CX211TXNT",
          policy: "PAUSE_ALL",
          members: [{ serial: "R5CX211TXNT", role: "LEADER", membershipState: "ACTIVE" }],
        },
      ],
      handleIncident,
      nowRealtimeMs: () => 90_000,
    });
    monitor.start();

    listener?.(
      parseLogcatLine(
        "08-13 12:00:00.001 123 123 F AndroidRuntime: FATAL EXCEPTION: main",
        "R5CX211TXNT",
        10,
      ),
    );
    listener?.(
      parseLogcatLine(
        "08-13 12:00:01.001 124 124 E ActivityManager: ANR in com.hg.idleweaponshoptycoon.android",
        "R5CX211TXNT",
        20,
      ),
    );
    await monitor.flush();

    expect(handleIncident).toHaveBeenCalledTimes(2);
    expect(handleIncident.mock.calls.map(([input]) => input.incident.category)).toEqual([
      "APP_CRASH_OR_ANR",
      "APP_CRASH_OR_ANR",
    ]);
  });

  it("ignores ordinary errors, filters inactive runs, and deduplicates the same record", async () => {
    let listener: ((record: ReturnType<typeof parseLogcatLine>) => void) | undefined;
    const handleIncident = vi.fn(async (input: { incident: unknown }) => input);
    const monitor = new LogcatFaultMonitor({
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      listRuns: () => [
        {
          runId: "run-a",
          serial: "R5CX211TXNT",
          policy: "PAUSE_ALL",
          members: [{ serial: "R5CX211TXNT", role: "LEADER", membershipState: "QUARANTINED" }],
        },
      ],
      handleIncident,
    });
    monitor.start();
    const ordinary = parseLogcatLine(
      "08-13 12:00:02.001 123 123 E Unity: failed to load asset",
      "R5CX211TXNT",
      30,
    );
    listener?.(ordinary);
    listener?.(ordinary);
    await monitor.flush();
    expect(handleIncident).not.toHaveBeenCalled();

    monitor.stop();
    listener?.(
      parseLogcatLine(
        "08-13 12:00:03.001 125 125 F AndroidRuntime: FATAL EXCEPTION: main",
        "R5CX211TXNT",
        40,
      ),
    );
    await monitor.flush();
    expect(handleIncident).not.toHaveBeenCalled();
  });
});
