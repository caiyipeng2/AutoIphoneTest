import type { DeviceSerial } from "@test-center/contracts/device";

import type { DeviceWorker } from "@test-center/sessions";
import type { ActionBarrier, RuntimeFaultEvent, TextFocusSnapshot } from "@test-center/sessions";
import type { LogcatRecord } from "@test-center/contracts/logcat";

export interface RuntimeWorkerFactoryInput {
  readonly runId: string;
  readonly serial: DeviceSerial;
  readonly packageName: string;
  readonly runNonceHash: string;
  readonly logcatRecordSink: (record: LogcatRecord) => void;
  readonly faultSink: (event: RuntimeFaultEvent) => void;
}

export type RuntimeWorkerFactory = (
  input: RuntimeWorkerFactoryInput,
) => Pick<DeviceWorker, "start" | "stop"> &
  Partial<Pick<DeviceWorker, "getActionBarrier" | "getTextFocusSnapshot">>;

export class RuntimeWorkerCoordinator {
  private readonly runs = new Map<string, Map<DeviceSerial, RuntimeWorkerFactoryReturn>>();
  private readonly logcatListeners = new Set<(record: LogcatRecord) => void>();
  private readonly faultListeners = new Set<(event: RuntimeFaultEvent) => void>();

  public constructor(private readonly factory: RuntimeWorkerFactory) {}

  public async start(
    runId: string,
    serials: readonly DeviceSerial[],
    packageName: string,
    runNonceHash: string,
  ): Promise<void> {
    if (this.runs.has(runId)) throw new Error(`Workers already exist for run '${runId}'.`);
    const workers = new Map<DeviceSerial, RuntimeWorkerFactoryReturn>();
    this.runs.set(runId, workers);
    try {
      await Promise.all(
        serials.map(async (serial) => {
          const worker = this.factory({
            runId,
            serial,
            packageName,
            runNonceHash,
            logcatRecordSink: (record) => this.emitLogcat(record),
            faultSink: (event) => this.emitFault(event),
          });
          workers.set(serial, worker);
          await worker.start();
        }),
      );
    } catch (error) {
      await this.stopWorkers(workers);
      this.runs.delete(runId);
      throw error;
    }
  }

  public async stop(runId: string): Promise<void> {
    const workers = this.runs.get(runId);
    if (workers === undefined) return;
    this.runs.delete(runId);
    await this.stopWorkers(workers);
  }

  public async stopAll(): Promise<void> {
    const runIds = [...this.runs.keys()];
    const results = await Promise.allSettled(runIds.map((runId) => this.stop(runId)));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  public list(runId: string): readonly DeviceSerial[] {
    return [...(this.runs.get(runId)?.keys() ?? [])];
  }

  public getActionBarrier(runId: string, serial: DeviceSerial): ActionBarrier | undefined {
    return this.runs.get(runId)?.get(serial)?.getActionBarrier?.();
  }

  public getTextFocusSnapshot(runId: string, serial: DeviceSerial): TextFocusSnapshot | undefined {
    const snapshot = this.runs.get(runId)?.get(serial)?.getTextFocusSnapshot?.();
    return snapshot === undefined ? undefined : { ...snapshot, serial };
  }

  public subscribeLogcat(listener: (record: LogcatRecord) => void): () => void {
    this.logcatListeners.add(listener);
    return () => this.logcatListeners.delete(listener);
  }

  public subscribeFault(listener: (event: RuntimeFaultEvent) => void): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }

  private emitLogcat(record: LogcatRecord): void {
    for (const listener of this.logcatListeners) listener(record);
  }

  private emitFault(event: RuntimeFaultEvent): void {
    for (const listener of this.faultListeners) listener(event);
  }

  private async stopWorkers(workers: Map<DeviceSerial, RuntimeWorkerFactoryReturn>): Promise<void> {
    const results = await Promise.allSettled([...workers.values()].map((worker) => worker.stop()));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }
}

type RuntimeWorkerFactoryReturn = Pick<DeviceWorker, "start" | "stop"> &
  Partial<Pick<DeviceWorker, "getActionBarrier" | "getTextFocusSnapshot">>;
