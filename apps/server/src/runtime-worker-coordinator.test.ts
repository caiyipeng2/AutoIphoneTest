import { describe, expect, it, vi } from "vitest";

import type { DeviceSerial } from "@test-center/contracts/device";

import {
  RuntimeWorkerCoordinator,
  type RuntimeWorkerFactory,
} from "./runtime-worker-coordinator.js";

const serials = ["R5CX211TXNT", "R5CWB17PN0Y", "R5CRC342PRF", "R5CRB123ABC"] as DeviceSerial[];

function createFactory(
  options: { failSerial: DeviceSerial | undefined } = { failSerial: undefined },
) {
  const workers = new Map<
    DeviceSerial,
    {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      getActionBarrier: ReturnType<typeof vi.fn>;
      getTextFocusSnapshot: ReturnType<typeof vi.fn>;
    }
  >();
  const factory: RuntimeWorkerFactory = (input) => {
    const worker = {
      start: vi.fn(async () => {
        if (input.serial === options.failSerial) throw new Error(`start failed: ${input.serial}`);
      }),
      stop: vi.fn(async () => undefined),
      getActionBarrier: vi.fn(() => ({ arm: vi.fn() })),
      getTextFocusSnapshot: vi.fn(() => undefined),
    };
    workers.set(input.serial, worker);
    return worker;
  };
  return { factory, workers };
}

describe("RuntimeWorkerCoordinator", () => {
  it("starts one through four workers concurrently and stops all workers", async () => {
    const { factory, workers } = createFactory();
    const coordinator = new RuntimeWorkerCoordinator(factory);

    await coordinator.start("run-1", serials.slice(0, 4), "com.example.game", "sha256:nonce");
    expect([...workers.values()].every((worker) => worker.start.mock.calls.length === 1)).toBe(
      true,
    );
    expect(coordinator.list("run-1")).toEqual(serials.slice(0, 4));
    expect(coordinator.getActionBarrier("run-1", serials[0]!)).toMatchObject({
      arm: expect.any(Function),
    });
    expect(coordinator.getTextFocusSnapshot("run-1", serials[0]!)).toBeUndefined();

    await coordinator.stop("run-1");
    expect([...workers.values()].every((worker) => worker.stop.mock.calls.length === 1)).toBe(true);
    expect(coordinator.list("run-1")).toEqual([]);
  });

  it("stops already-started workers when one worker fails", async () => {
    const { factory, workers } = createFactory({ failSerial: serials[1] });
    const coordinator = new RuntimeWorkerCoordinator(factory);

    await expect(
      coordinator.start("run-2", serials.slice(0, 3), "com.example.game", "sha256:nonce"),
    ).rejects.toThrow("start failed");
    expect(
      [...workers.values()].filter((worker) => worker.stop.mock.calls.length === 1),
    ).toHaveLength(3);
    expect(coordinator.list("run-2")).toEqual([]);
  });
});
