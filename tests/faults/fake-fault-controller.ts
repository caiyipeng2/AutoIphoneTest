import type { IncidentCategory } from "../../packages/contracts/src/incident.js";
import type { RuntimeFaultEvent } from "../../packages/sessions/src/runtime-fault-monitor.js";

export type FakeFault =
  | { readonly kind: "runtime"; readonly event: RuntimeFaultEvent }
  | {
      readonly kind: "incident";
      readonly category: IncidentCategory;
      readonly runId: string;
      readonly serial?: string;
    };

/** Test-only deterministic source; production code has no route to this controller. */
export class FakeFaultController {
  private readonly listeners = new Set<(fault: FakeFault) => void>();
  public subscribe(listener: (fault: FakeFault) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public emitRuntime(event: RuntimeFaultEvent): void {
    this.emit({ kind: "runtime", event });
  }
  public emitIncident(input: {
    readonly category: IncidentCategory;
    readonly runId: string;
    readonly serial?: string;
  }): void {
    this.emit({ kind: "incident", ...input });
  }
  private emit(fault: FakeFault): void {
    for (const listener of this.listeners) listener(fault);
  }
}
