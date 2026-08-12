import {
  AppiumW3cClient,
  type AppiumW3cClientOptions,
  type DeviceSessionCapabilities,
  type SessionFence,
  type W3cAction,
} from "@test-center/appium";

import type { ActionPayload } from "./run-repository.js";
import type { ActionCommand } from "./action-command.js";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface AppiumActionClient {
  createSession(capabilities: DeviceSessionCapabilities): Promise<SessionFence>;
  activateApp(fence: SessionFence, packageName: string): Promise<void>;
  currentPackage(fence: SessionFence): Promise<string>;
  pressKey(fence: SessionFence, keycode: number, metastate?: number): Promise<void>;
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
  readonly payload?: ActionPayload;
  readonly command?: ActionCommand;
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
      const actions =
        input.command?.type === "back" || input.command?.type === "activate"
          ? []
          : createPointerActions(
              input.payload ?? { kind: "tap", x: 0.5, y: 0.5 },
              this.options.viewport,
            );
      if (input.command?.type === "back") await client.pressKey(fence, 4);
      else if (input.command?.type !== "activate") await client.performActions(fence, actions);
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
    return createCommandPointerActions({ type: "tap", x: payload.x, y: payload.y }, viewport);
  }
  return createPathPointerActions(payload.path, payload.durationMs, viewport);
}

export function createCommandPointerActions(
  command: Extract<ActionCommand, { type: "tap" | "longPress" | "swipe" | "drag" }>,
  viewport: ViewportSize,
): readonly W3cAction[] {
  assertViewport(viewport);
  if (command.type === "tap") {
    const point = toViewportPoint([command.x, command.y], viewport);
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
  if (command.type === "longPress") {
    const point = toViewportPoint([command.x, command.y], viewport);
    return [
      {
        type: "pointer",
        id: "test-center-finger",
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x: point[0], y: point[1] },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: command.durationMs },
          { type: "pointerUp", button: 0 },
        ],
      },
    ];
  }
  return createPathPointerActions(command.path, command.durationMs, viewport);
}

function createPathPointerActions(
  path: readonly (readonly [number, number])[],
  durationMs: number,
  viewport: ViewportSize,
): readonly W3cAction[] {
  const points = path.map((point) => toViewportPoint(point, viewport));
  const segmentCount = points.length - 1;
  const baseDuration = Math.floor(durationMs / segmentCount);
  const remainder = durationMs - baseDuration * segmentCount;
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
