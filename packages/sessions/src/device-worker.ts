import type {
  AppiumW3cClient,
  DeviceSessionCapabilities,
  PortLease,
  PortAllocator,
  SessionFence,
} from "@test-center/appium";
import type { LogcatStream } from "@test-center/adb";
import type { WorkerResourceLease, WorkerResourceManager } from "./worker-resource-manager.js";

export type DeviceWorkerState =
  "DISCONNECTED" | "STARTING" | "READY" | "STOPPING" | "STOPPED" | "ERROR";

export interface DeviceWorkerIdentity {
  readonly serial: string;
  readonly packageName: string;
}

export interface DeviceWorkerOwner {
  readonly ownerPid: number;
  readonly ownerToken: string;
}

export interface DeviceWorkerClientFactoryInput {
  readonly serial: string;
  readonly generation: number;
  readonly lease: PortLease;
  readonly baseUrl: string;
}

export interface DeviceWorkerLogcatFactoryInput {
  readonly serial: string;
  readonly generation: number;
  readonly lease: PortLease;
}

export interface AppiumServiceLike {
  start(): Promise<{ readonly pid: number }>;
  stop(): Promise<void>;
}

export interface DeviceWorkerAppiumServiceFactoryInput {
  readonly serial: string;
  readonly generation: number;
  readonly port: number;
  readonly logPath: string;
  readonly resourceLease: WorkerResourceLease;
}

export interface DeviceWorkerOptions {
  readonly serial: string;
  readonly packageName: string;
  readonly owner: DeviceWorkerOwner;
  readonly allocator?: Pick<PortAllocator, "allocate" | "release">;
  readonly identityProbe: () => Promise<DeviceWorkerIdentity>;
  readonly clientFactory: (input: DeviceWorkerClientFactoryInput) => AppiumW3cClient;
  readonly logcatFactory: (input: DeviceWorkerLogcatFactoryInput) => LogcatStream;
  readonly runId?: string;
  readonly resourceManager?: Pick<WorkerResourceManager, "allocate" | "release">;
  readonly appiumServiceFactory?: (
    input: DeviceWorkerAppiumServiceFactoryInput,
  ) => AppiumServiceLike;
  readonly appiumBaseUrl?: (lease: PortLease) => string;
}

export type DeviceWorkerErrorCode =
  "INVALID_STATE" | "IDENTITY_MISMATCH" | "START_FAILED" | "STOP_FAILED";

export class DeviceWorkerError extends Error {
  public constructor(
    public readonly code: DeviceWorkerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeviceWorkerError";
  }
}

export class DeviceWorker {
  private readonly serial: string;
  private readonly packageName: string;
  private readonly owner: DeviceWorkerOwner;
  private readonly allocator: DeviceWorkerOptions["allocator"];
  private readonly identityProbe: DeviceWorkerOptions["identityProbe"];
  private readonly clientFactory: DeviceWorkerOptions["clientFactory"];
  private readonly logcatFactory: DeviceWorkerOptions["logcatFactory"];
  private readonly runId: string | undefined;
  private readonly resourceManager: DeviceWorkerOptions["resourceManager"];
  private readonly appiumServiceFactory: DeviceWorkerOptions["appiumServiceFactory"];
  private readonly appiumBaseUrl: (lease: PortLease) => string;
  private readonly stateListeners = new Set<(state: DeviceWorkerState) => void>();
  private _state: DeviceWorkerState = "DISCONNECTED";
  private _generation = 1;
  private lease: PortLease | undefined;
  private client: AppiumW3cClient | undefined;
  private fence: SessionFence | undefined;
  private logcat: LogcatStream | undefined;
  private appium: AppiumServiceLike | undefined;
  private resourceLease: WorkerResourceLease | undefined;

  public constructor(options: DeviceWorkerOptions) {
    if (!options.serial.trim() || !options.packageName.trim())
      throw new TypeError("Device worker serial and packageName are required.");
    this.serial = options.serial;
    this.packageName = options.packageName;
    this.owner = options.owner;
    this.allocator = options.allocator;
    this.identityProbe = options.identityProbe;
    this.clientFactory = options.clientFactory;
    this.logcatFactory = options.logcatFactory;
    if ((options.runId === undefined) !== (options.resourceManager === undefined))
      throw new TypeError("runId and resourceManager must be configured together.");
    if ((options.runId !== undefined) !== (options.appiumServiceFactory !== undefined))
      throw new TypeError("Managed workers require an Appium service factory.");
    if (options.runId === undefined && options.allocator === undefined)
      throw new TypeError("Legacy workers require a port allocator.");
    this.runId = options.runId;
    this.resourceManager = options.resourceManager;
    this.appiumServiceFactory = options.appiumServiceFactory;
    this.appiumBaseUrl =
      options.appiumBaseUrl ?? ((lease) => `http://127.0.0.1:${String(lease.appiumPort)}`);
  }

  public get state(): DeviceWorkerState {
    return this._state;
  }
  public get generation(): number {
    return this._generation;
  }

  public onStateChange(listener: (state: DeviceWorkerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public getFence(): SessionFence | undefined {
    return this.fence === undefined ? undefined : { ...this.fence };
  }

  public async start(): Promise<void> {
    if (this._state === "STARTING" || this._state === "READY" || this._state === "STOPPING") {
      throw new DeviceWorkerError("INVALID_STATE", `Cannot start worker from ${this._state}.`);
    }
    this.setState("STARTING");
    let lease: PortLease | undefined;
    let resourceLease: WorkerResourceLease | undefined;
    let appium: AppiumServiceLike | undefined;
    let appiumStarted = false;
    let client: AppiumW3cClient | undefined;
    let fence: SessionFence | undefined;
    let logcat: LogcatStream | undefined;
    let logcatStarted = false;
    try {
      const identity = await this.identityProbe();
      if (identity.serial !== this.serial || identity.packageName !== this.packageName) {
        throw new DeviceWorkerError(
          "IDENTITY_MISMATCH",
          `Device identity mismatch for ${this.serial}.`,
        );
      }
      if (this.isManaged()) {
        resourceLease = await this.resourceManager!.allocate({
          runId: this.runId!,
          serial: this.serial,
          generation: this._generation,
        });
        lease = toPortLease(resourceLease, this.owner);
        appium = this.appiumServiceFactory!({
          serial: this.serial,
          generation: this._generation,
          port: resourceLease.ports.appium,
          logPath: resourceLease.paths.logs,
          resourceLease,
        });
        await appium.start();
        appiumStarted = true;
      } else {
        lease = await this.allocator!.allocate(this.serial, this.owner);
      }
      client = this.clientFactory({
        serial: this.serial,
        generation: this._generation,
        lease,
        baseUrl: this.appiumBaseUrl(lease),
      });
      fence = await client.createSession(this.createCapabilities(lease));
      logcat = this.logcatFactory({ serial: this.serial, generation: this._generation, lease });
      await logcat.start();
      logcatStarted = true;
      this.lease = lease;
      this.client = client;
      this.fence = fence;
      this.logcat = logcat;
      this.appium = appium;
      this.resourceLease = resourceLease;
      this.setState("READY");
    } catch (error) {
      if (fence !== undefined && client !== undefined)
        await client.deleteSession(fence).catch(() => undefined);
      if (logcatStarted) await logcat?.stop().catch(() => undefined);
      if (appiumStarted) await appium?.stop().catch(() => undefined);
      if (resourceLease !== undefined)
        await this.resourceManager!.release(resourceLease, this.owner.ownerToken).catch(
          () => undefined,
        );
      else if (lease !== undefined)
        await this.allocator!.release(lease.leaseId, this.owner).catch(() => undefined);
      this.setState("ERROR");
      if (error instanceof DeviceWorkerError) throw error;
      throw new DeviceWorkerError(
        "START_FAILED",
        `Device worker failed to start: ${error instanceof Error ? error.message : "unknown error"}.`,
        { cause: error },
      );
    }
  }

  public async stop(): Promise<void> {
    if (this._state === "DISCONNECTED" || this._state === "STOPPED") return;
    if (this._state === "STARTING" || this._state === "STOPPING")
      throw new DeviceWorkerError("INVALID_STATE", `Cannot stop worker from ${this._state}.`);
    this.setState("STOPPING");
    const logcat = this.logcat;
    const client = this.client;
    const fence = this.fence;
    const lease = this.lease;
    const appium = this.appium;
    const resourceLease = this.resourceLease;
    let firstError: unknown;
    try {
      await logcat?.stop();
    } catch (error) {
      firstError ??= error;
    }
    try {
      if (client !== undefined && fence !== undefined) await client.deleteSession(fence);
    } catch (error) {
      firstError ??= error;
    }
    try {
      if (appium !== undefined) await appium.stop();
    } catch (error) {
      firstError ??= error;
    }
    try {
      if (resourceLease !== undefined)
        await this.resourceManager!.release(resourceLease, this.owner.ownerToken);
      else if (lease !== undefined) await this.allocator!.release(lease.leaseId, this.owner);
    } catch (error) {
      firstError ??= error;
    }
    this.logcat = undefined;
    this.client = undefined;
    this.fence = undefined;
    this.lease = undefined;
    this.appium = undefined;
    this.resourceLease = undefined;
    this._generation += 1;
    this.setState(firstError === undefined ? "STOPPED" : "ERROR");
    if (firstError !== undefined)
      throw new DeviceWorkerError("STOP_FAILED", "Device worker failed to stop cleanly.", {
        cause: firstError,
      });
  }

  private createCapabilities(lease: PortLease): DeviceSessionCapabilities {
    return {
      platformName: "Android",
      automationName: "UiAutomator2",
      udid: this.serial,
      systemPort: lease.systemPort,
      mjpegServerPort: lease.mjpegPort,
      noReset: true,
      newCommandTimeout: 60,
    };
  }

  private setState(state: DeviceWorkerState): void {
    this._state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  private isManaged(): boolean {
    return this.runId !== undefined;
  }
}

function toPortLease(resourceLease: WorkerResourceLease, owner: DeviceWorkerOwner): PortLease {
  return {
    leaseId: resourceLease.appiumLeaseId,
    serial: resourceLease.identity.serial,
    appiumPort: resourceLease.ports.appium,
    systemPort: resourceLease.ports.system,
    mjpegPort: resourceLease.ports.mjpeg,
    ownerPid: owner.ownerPid,
    ownerToken: owner.ownerToken,
    createdAt: Date.now(),
  };
}
