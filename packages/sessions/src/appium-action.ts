import {
  AppiumW3cClient,
  type AppiumW3cClientOptions,
  type DeviceSessionCapabilities,
  type SessionFence,
  type W3cAction,
} from "@test-center/appium";

import type { ActionPayload } from "./run-repository.js";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface AppiumActionClient {
  createSession(capabilities: DeviceSessionCapabilities): Promise<SessionFence>;
  activateApp(fence: SessionFence, packageName: string): Promise<void>;
  currentPackage(fence: SessionFence): Promise<string>;
  performActions(fence: SessionFence, actions: readonly W3cAction[]): Promise<void>;
  deleteSession(fence: SessionFence): Promise<void>;
}

export interface AppiumActionExecutorOptions {
  readonly baseUrl: string;
  readonly systemPort: number;
  readonly mjpegServerPort: number;
  readonly viewport: ViewportSize;
  readonly requestTimeoutMs?: number;
  readonly foregroundTimeoutMs?: number;
  readonly foregroundPollIntervalMs?: number;
  readonly clientFactory?: (options: AppiumW3cClientOptions) => AppiumActionClient;
}

export interface AppiumActionInput {
  readonly serial: string;
  readonly packageName: string;
  readonly payload: ActionPayload;
}

export interface AppiumActionResult {
  readonly serial: string;
  readonly packageName: string;
  readonly foregroundPackage: string;
  readonly pointerActionCount: number;
}

export class AppiumActionExecutor {
  public constructor(private readonly options: AppiumActionExecutorOptions) {
    assertViewport(options.viewport);
  }

  public async execute(input: AppiumActionInput): Promise<AppiumActionResult> {
    if (!input.serial.trim() || !input.packageName.trim()) {
      throw new TypeError("Appium action serial and packageName are required.");
    }
    const client = (this.options.clientFactory ?? ((options) => new AppiumW3cClient(options)))({
      baseUrl: this.options.baseUrl,
      serial: input.serial,
      generation: 1,
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
      const foregroundPackage = await this.waitForForegroundPackage(
        client,
        fence,
        input.packageName,
      );
      const actions = createPointerActions(input.payload, this.options.viewport);
      await client.performActions(fence, actions);
      return {
        serial: input.serial,
        packageName: input.packageName,
        foregroundPackage,
        pointerActionCount: actions[0]?.actions.length ?? 0,
      };
    } finally {
      if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
    }
  }

  private async waitForForegroundPackage(
    client: AppiumActionClient,
    fence: SessionFence,
    packageName: string,
  ): Promise<string> {
    const timeoutMs = this.options.foregroundTimeoutMs ?? 5_000;
    const pollIntervalMs = this.options.foregroundPollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    let currentPackage = await client.currentPackage(fence);
    while (currentPackage !== packageName && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      currentPackage = await client.currentPackage(fence);
    }
    if (currentPackage !== packageName) {
      throw new Error(`Appium action foreground package mismatch: ${currentPackage}.`);
    }
    return currentPackage;
  }
}

export function createPointerActions(
  payload: ActionPayload,
  viewport: ViewportSize,
): readonly W3cAction[] {
  assertViewport(viewport);
  if (payload.kind === "tap") {
    const point = toViewportPoint([payload.x, payload.y], viewport);
    return [
      {
        type: "pointer",
        id: "test-center-finger",
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x: point[0], y: point[1] },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ];
  }
  const points = payload.path.map((point) => toViewportPoint(point, viewport));
  const segmentCount = points.length - 1;
  const baseDuration = Math.floor(payload.durationMs / segmentCount);
  const remainder = payload.durationMs - baseDuration * segmentCount;
  const actions: Record<string, unknown>[] = [
    { type: "pointerMove", duration: 0, origin: "viewport", x: points[0]![0], y: points[0]![1] },
    { type: "pointerDown", button: 0 },
  ];
  points.slice(1).forEach((point, index) => {
    actions.push({
      type: "pointerMove",
      duration: baseDuration + (index === segmentCount - 1 ? remainder : 0),
      origin: "viewport",
      x: point[0],
      y: point[1],
    });
  });
  actions.push({ type: "pointerUp", button: 0 });
  return [{ type: "pointer", id: "test-center-finger", actions }];
}

function toViewportPoint(
  point: readonly [number, number],
  viewport: ViewportSize,
): readonly [number, number] {
  return [
    Math.round(point[0] * (viewport.width - 1)),
    Math.round(point[1] * (viewport.height - 1)),
  ];
}

function assertViewport(viewport: ViewportSize): void {
  if (
    !Number.isSafeInteger(viewport.width) ||
    !Number.isSafeInteger(viewport.height) ||
    viewport.width < 2 ||
    viewport.height < 2
  ) {
    throw new TypeError("Appium action viewport must contain integer dimensions of at least 2px.");
  }
}
