import {
  AppiumW3cClient,
  type AppiumW3cClientOptions,
  type DeviceSessionCapabilities,
  type SessionFence,
} from "@test-center/appium";

export interface AppiumPreflightInput {
  readonly serial: string;
  readonly packageName: string;
}

export interface AppiumPreflightClient {
  createSession(capabilities: DeviceSessionCapabilities): Promise<SessionFence>;
  activateApp(fence: SessionFence, packageName: string): Promise<void>;
  currentPackage(fence: SessionFence): Promise<string>;
  deleteSession(fence: SessionFence): Promise<void>;
}

export interface AppiumPreflightProbeOptions {
  readonly baseUrl: string;
  readonly systemPort: number;
  readonly mjpegServerPort: number;
  readonly requestTimeoutMs?: number;
  readonly foregroundTimeoutMs?: number;
  readonly foregroundPollIntervalMs?: number;
  readonly clientFactory?: (options: AppiumW3cClientOptions) => AppiumPreflightClient;
}

export class AppiumPreflightProbe {
  private readonly options: AppiumPreflightProbeOptions;
  private generation = 0;

  public constructor(options: AppiumPreflightProbeOptions) {
    if (
      !Number.isSafeInteger(options.systemPort) ||
      options.systemPort < 1 ||
      options.systemPort > 65_535
    ) {
      throw new TypeError("Appium systemPort is invalid.");
    }
    if (
      !Number.isSafeInteger(options.mjpegServerPort) ||
      options.mjpegServerPort < 1 ||
      options.mjpegServerPort > 65_535
    ) {
      throw new TypeError("Appium mjpegServerPort is invalid.");
    }
    this.options = options;
  }

  public async check(input: AppiumPreflightInput): Promise<void> {
    if (input.serial.trim().length === 0 || input.packageName.trim().length === 0) {
      throw new TypeError("Appium preflight serial and packageName are required.");
    }
    const generation = ++this.generation;
    const client = (this.options.clientFactory ?? ((options) => new AppiumW3cClient(options)))({
      baseUrl: this.options.baseUrl,
      serial: input.serial,
      generation,
      ...(this.options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: this.options.requestTimeoutMs }),
    });
    let fence: SessionFence | undefined;
    try {
      fence = await client.createSession({
        platformName: "Android",
        automationName: "UiAutomator2",
        udid: input.serial,
        systemPort: this.options.systemPort,
        mjpegServerPort: this.options.mjpegServerPort,
        noReset: true,
        newCommandTimeout: 60,
      });
      await client.activateApp(fence, input.packageName);
      await this.waitForForegroundPackage(client, fence, input.packageName);
    } finally {
      if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
    }
  }

  private async waitForForegroundPackage(
    client: AppiumPreflightClient,
    fence: SessionFence,
    packageName: string,
  ): Promise<void> {
    const timeoutMs = this.options.foregroundTimeoutMs ?? 5_000;
    const pollIntervalMs = this.options.foregroundPollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    let currentPackage = await client.currentPackage(fence);
    while (currentPackage !== packageName && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      currentPackage = await client.currentPackage(fence);
    }
    if (currentPackage !== packageName) {
      throw new Error(`Appium preflight foreground package mismatch: ${currentPackage}.`);
    }
  }
}
