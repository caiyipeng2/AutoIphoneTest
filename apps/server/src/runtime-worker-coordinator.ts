import type { DeviceSerial } from "@test-center/contracts/device";

import type { DeviceWorker, DeviceWorkerScreenshot } from "@test-center/sessions";
import type { ActionBarrier, RuntimeFaultEvent, TextFocusSnapshot } from "@test-center/sessions";
import type { LogcatRecord } from "@test-center/contracts/logcat";
import type { ActionCommand } from "@test-center/sessions";
import type { ActionPayload } from "@test-center/sessions";

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
  Partial<Pick<DeviceWorker, "executeAction">> &
  Partial<Pick<DeviceWorker, "captureScreenshot">> &
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
      // Appium/UiAutomator2 installation touches each device's ADB transport.
      // Establish workers one at a time to avoid device-side bootstrap races;
      // action dispatch remains concurrent after every worker is READY.
      for (const serial of serials) {
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
      }
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

  public getActionExecutor(runId: string, serial: DeviceSerial) {
    return this.runs.get(runId)?.get(serial)?.executeAction === undefined
      ? undefined
      : {
          execute: (input: {
            readonly packageName: string;
            readonly payload?: ActionPayload;
            readonly command?: ActionCommand;
          }) => this.runs.get(runId)!.get(serial)!.executeAction!(input),
        };
  }

  public getActionBarrier(runId: string, serial: DeviceSerial): ActionBarrier | undefined {
    return this.runs.get(runId)?.get(serial)?.getActionBarrier?.();
  }

  public getTextFocusSnapshot(runId: string, serial: DeviceSerial): TextFocusSnapshot | undefined {
    const snapshot = this.runs.get(runId)?.get(serial)?.getTextFocusSnapshot?.();
    return snapshot === undefined ? undefined : { ...snapshot, serial };
  }

  public getScreenshotCapture(
    runId: string,
    serial: DeviceSerial,
  ): (() => Promise<DeviceWorkerScreenshot>) | undefined {
    if (this.runs.get(runId)?.get(serial)?.captureScreenshot === undefined) return undefined;
    return async () => {
      const worker = this.runs.get(runId)?.get(serial);
      if (worker?.captureScreenshot === undefined) {
        throw new Error(
          `Screenshot capture is unavailable for run '${runId}', serial '${serial}'.`,
        );
      }
      return await worker.captureScreenshot();
    };
  }

  public subscribeLogcat(listener: (record: LogcatRecord) => void): () => void {
    this.logcatListeners.add(listener);
    return () => this.logcatListeners.delete(listener);
  }

  public subscribeFault(listener: (event: RuntimeFaultEvent) => void): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }

  public publishFault(event: RuntimeFaultEvent): void {
    this.emitFault(event);
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
  Partial<Pick<DeviceWorker, "executeAction">> &
  Partial<Pick<DeviceWorker, "captureScreenshot">> &
  Partial<Pick<DeviceWorker, "getActionBarrier" | "getTextFocusSnapshot">>;
