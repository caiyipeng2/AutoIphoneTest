import {
  AppiumW3cClient,
  AppiumW3cClientError,
  type AppiumW3cClientOptions,
  type DeviceSessionCapabilities,
  type SessionFence,
  type W3cAction,
} from "@test-center/appium";

import type { ActionPayload } from "./run-repository.js";
import type { ActionCommand } from "./action-command.js";

export type AppiumActionFaultCategory =
  "APPIUM_SESSION_LOST" | "BRIDGE_TIMEOUT" | "BRIDGE_STATE_MISMATCH";

export interface AppiumActionFaultEvent {
  readonly runId: string;
  readonly actionId: string;
  readonly serial: string;
  readonly category: AppiumActionFaultCategory;
  readonly faultId: string;
  readonly source: "appium-action";
  readonly message: string;
  readonly detectedAt: string;
  readonly detectedAtRealtimeMs: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface AppiumActionClient {
  createSession(capabilities: DeviceSessionCapabilities): Promise<SessionFence>;
  activateApp(fence: SessionFence, packageName: string): Promise<void>;
  terminateApp(fence: SessionFence, packageName: string): Promise<void>;
  currentPackage(fence: SessionFence): Promise<string | undefined>;
  pressKey(fence: SessionFence, keycode: number, metastate?: number): Promise<void>;
  typeText?(fence: SessionFence, text: string): Promise<void>;
  performActions(fence: SessionFence, actions: readonly W3cAction[]): Promise<void>;
  deleteSession(fence: SessionFence): Promise<void>;
}

export interface AppiumActionExecutorOptions {
  readonly baseUrl: string;
  readonly systemPort: number;
  readonly mjpegServerPort: number;
  readonly adbPort?: number;
  readonly suppressKillServer?: boolean;
  readonly viewport: ViewportSize;
  readonly requestTimeoutMs?: number;
  readonly foregroundTimeoutMs?: number;
  readonly foregroundPollIntervalMs?: number;
  readonly processProbe?: (serial: string, packageName: string) => Promise<boolean>;
  readonly clientFactory?: (options: AppiumW3cClientOptions) => AppiumActionClient;
  readonly faultSink?: (event: AppiumActionFaultEvent) => void;
}

export interface AppiumActionInput {
  readonly runId?: string;
  readonly actionId?: string;
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
    if (
      options.adbPort !== undefined &&
      (!Number.isSafeInteger(options.adbPort) || options.adbPort < 1 || options.adbPort > 65_535)
    ) {
      throw new TypeError("Appium adbPort is invalid.");
    }
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
        ...(this.options.adbPort === undefined ? {} : { adbPort: this.options.adbPort }),
        ...(this.options.suppressKillServer === undefined
          ? {}
          : { suppressKillServer: this.options.suppressKillServer }),
        noReset: true,
        newCommandTimeout: 60,
      });
      await client.activateApp(fence, input.packageName);
      const foregroundPackage = await this.waitForForegroundPackage(
        client,
        fence,
        input.packageName,
      );
      if (input.command?.type === "terminate") {
        await client.terminateApp(fence, input.packageName);
        await this.waitForProcessAbsent(input.serial, input.packageName);
        return {
          serial: input.serial,
          packageName: input.packageName,
          foregroundPackage,
          pointerActionCount: 0,
        };
      }
      if (input.command?.type === "restart") {
        await client.terminateApp(fence, input.packageName);
        await this.waitForProcessAbsent(input.serial, input.packageName);
        await client.activateApp(fence, input.packageName);
        await this.waitForForegroundPackage(client, fence, input.packageName);
        return {
          serial: input.serial,
          packageName: input.packageName,
          foregroundPackage: input.packageName,
          pointerActionCount: 0,
        };
      }
      if (input.command?.type === "text") {
        if (client.typeText === undefined) {
          throw new Error("Text action requires an Appium client with text input support.");
        }
        await client.typeText(fence, input.command.text);
        return {
          serial: input.serial,
          packageName: input.packageName,
          foregroundPackage,
          pointerActionCount: 0,
        };
      }
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
    } catch (error) {
      const fault = toActionFault(error, input);
      if (fault !== undefined) this.options.faultSink?.(fault);
      throw error;
    } finally {
      if (fence !== undefined) await client.deleteSession(fence).catch(() => undefined);
    }
  }

  private async waitForProcessAbsent(serial: string, packageName: string): Promise<void> {
    if (this.options.processProbe === undefined)
      throw new Error("Terminate action requires a process probe.");
    const timeoutMs = this.options.foregroundTimeoutMs ?? 5_000;
    const pollIntervalMs = this.options.foregroundPollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    while (await this.options.processProbe(serial, packageName)) {
      if (Date.now() >= deadline) throw new Error("Terminated app process did not exit in time.");
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
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

function toActionFault(
  error: unknown,
  input: AppiumActionInput,
): AppiumActionFaultEvent | undefined {
  if (!(error instanceof AppiumW3cClientError)) return undefined;
  const category: AppiumActionFaultCategory =
    error.code === "SESSION_NOT_FOUND"
      ? "APPIUM_SESSION_LOST"
      : error.code === "TIMEOUT" || error.code === "NETWORK_ERROR"
        ? "BRIDGE_TIMEOUT"
        : error.code === "FENCE_MISMATCH"
          ? "BRIDGE_STATE_MISMATCH"
          : undefined!;
  if (category === undefined || input.runId === undefined || input.actionId === undefined)
    return undefined;
  return {
    runId: input.runId,
    actionId: input.actionId,
    serial: input.serial,
    category,
    faultId: input.actionId,
    source: "appium-action",
    message: error.message,
    detectedAt: new Date().toISOString(),
    detectedAtRealtimeMs: Math.max(0, Date.now()),
  };
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
