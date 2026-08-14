import { describe, expect, it } from "vitest";
import { FakeFaultController } from "../faults/fake-fault-controller.js";

describe("FakeFaultController", () => {
  it("emits deterministic test-only faults and unsubscribes cleanly", () => {
    const controller = new FakeFaultController();
    const received: string[] = [];
    const remove = controller.subscribe((fault) =>
      received.push(fault.kind === "runtime" ? fault.event.faultId : fault.category),
    );
    controller.emitIncident({ category: "LOW_DISK", runId: "run-a" });
    remove();
    controller.emitIncident({ category: "ADB_DISCONNECTED", runId: "run-a", serial: "device-a" });
    expect(received).toEqual(["LOW_DISK"]);
  });
});
