import { performance } from "node:perf_hooks";

import { z } from "zod";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_INPUT_LENGTH = 4_096;

const CapabilitiesSchema = z
  .object({
    platformName: z.literal("Android"),
    automationName: z.literal("UiAutomator2"),
    udid: z.string().min(1).max(256),
    systemPort: z.number().int().min(1).max(65_535),
    mjpegServerPort: z.number().int().min(1).max(65_535),
    noReset: z.literal(true),
    newCommandTimeout: z.number().int().positive().max(86_400),
  })
  .strict();

const CreateSessionResponseSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    value: z
      .object({
        sessionId: z.string().min(1).optional(),
        capabilities: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const StringValueResponseSchema = z
  .object({ value: z.string().min(1).max(25_000_000) })
  .passthrough();
const EmptyValueResponseSchema = z.object({ value: z.unknown() }).passthrough();

const W3cActionSchema = z
  .object({
    type: z.literal("pointer"),
    id: z.string().min(1).max(64),
    actions: z.array(z.record(z.string(), z.unknown())).min(1).max(512),
  })
  .strict();

const SettingsSchema = z.record(
  z.string().min(1).max(128),
  z.union([z.string().max(512), z.number().finite(), z.boolean()]),
);

export type W3cAction = z.infer<typeof W3cActionSchema>;
export type DeviceSessionCapabilities = z.infer<typeof CapabilitiesSchema>;

export interface SessionFence {
  readonly sessionId: string;
  readonly serial: string;
  readonly generation: number;
}

export interface W3cRequestTiming {
  readonly method: string;
  readonly path: string;
  readonly durationMs: number;
  readonly status: number;
}

export interface AppiumW3cClientOptions {
  readonly baseUrl: string;
  readonly serial: string;
  readonly generation: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

export type AppiumW3cClientErrorCode =
  | "INVALID_ARGUMENT"
  | "FENCE_MISMATCH"
  | "SESSION_ALREADY_EXISTS"
  | "SESSION_NOT_FOUND"
  | "APPIUM_ERROR"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PROTOCOL_ERROR"
  | "RESPONSE_TOO_LARGE";

export class AppiumW3cClientError extends Error {
  public constructor(
    public readonly code: AppiumW3cClientErrorCode,
    message: string,
    options?: ErrorOptions & { readonly httpStatus?: number },
  ) {
    super(message, options);
    this.name = "AppiumW3cClientError";
    if (options?.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }

  public readonly httpStatus: number | undefined;
}

export class AppiumW3cClient {
  private readonly baseUrl: string;
  private readonly serial: string;
  private readonly generation: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  private activeFence: SessionFence | undefined;
  private lastTiming: W3cRequestTiming | undefined;

  public constructor(options: AppiumW3cClientOptions) {
    const parsedUrl = new URL(options.baseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new TypeError("Appium baseUrl must use HTTP or HTTPS.");
    }
    if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
      throw new TypeError("Appium baseUrl must point to the local loopback host.");
    }
    if (!options.serial.trim()) throw new TypeError("Appium serial must not be empty.");
    if (!Number.isSafeInteger(options.generation) || options.generation <= 0) {
      throw new TypeError("Appium worker generation must be a positive safe integer.");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.serial = options.serial;
    this.generation = options.generation;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new TypeError("requestTimeoutMs must be greater than zero.");
    }
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new TypeError("maxResponseBytes must be a positive safe integer.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public getLastTiming(): W3cRequestTiming | undefined {
    return this.lastTiming === undefined ? undefined : { ...this.lastTiming };
  }

  public async createSession(capabilities: DeviceSessionCapabilities): Promise<SessionFence> {
    if (this.activeFence !== undefined) {
      throw new AppiumW3cClientError(
        "SESSION_ALREADY_EXISTS",
        "An Appium session is already active.",
      );
    }
    const parsedCapabilities = CapabilitiesSchema.safeParse(capabilities);
    if (!parsedCapabilities.success || parsedCapabilities.data.udid !== this.serial) {
      throw new AppiumW3cClientError(
        "INVALID_ARGUMENT",
        "Session capabilities must be Android UiAutomator2 capabilities bound to the configured serial.",
      );
    }
    const body = await this.requestBody(
      "POST",
      "/session",
      {
        capabilities: {
          alwaysMatch: toW3cCapabilities(parsedCapabilities.data),
          firstMatch: [{}],
        },
      },
      CreateSessionResponseSchema,
    );
    const sessionId = body.sessionId ?? body.value.sessionId;
    if (sessionId === undefined) {
      throw new AppiumW3cClientError(
        "PROTOCOL_ERROR",
        "Appium create-session response omitted sessionId.",
      );
    }
    const fence: SessionFence = { sessionId, serial: this.serial, generation: this.generation };
    this.activeFence = fence;
    return fence;
  }

  public async deleteSession(fence: SessionFence): Promise<void> {
    await this.requestValue(
      fence,
      "DELETE",
      this.sessionPath(fence, ""),
      undefined,
      EmptyValueResponseSchema,
    );
    if (this.activeFence?.sessionId === fence.sessionId) this.activeFence = undefined;
  }

  public async performActions(fence: SessionFence, actions: readonly W3cAction[]): Promise<void> {
    const parsed = z.array(W3cActionSchema).min(1).max(10).safeParse(actions);
    if (!parsed.success)
      throw new AppiumW3cClientError("INVALID_ARGUMENT", "Invalid W3C pointer actions.");
    await this.requestValue(
      fence,
      "POST",
      this.sessionPath(fence, "actions"),
      { actions: parsed.data },
      EmptyValueResponseSchema,
    );
  }

  public async screenshot(fence: SessionFence): Promise<string> {
    return await this.requestValue(
      fence,
      "GET",
      this.sessionPath(fence, "screenshot"),
      undefined,
      StringValueResponseSchema,
    );
  }

  public async activateApp(fence: SessionFence, packageName: string): Promise<void> {
    await this.requestAppPackage(fence, "activate_app", packageName);
  }

  public async terminateApp(fence: SessionFence, packageName: string): Promise<void> {
    await this.requestAppPackage(fence, "terminate_app", packageName);
  }

  public async pressKey(fence: SessionFence, keycode: number, metastate?: number): Promise<void> {
    if (!Number.isSafeInteger(keycode) || keycode < 0) {
      throw new AppiumW3cClientError(
        "INVALID_ARGUMENT",
        "Android keycode must be a non-negative integer.",
      );
    }
    if (metastate !== undefined && (!Number.isSafeInteger(metastate) || metastate < 0)) {
      throw new AppiumW3cClientError(
        "INVALID_ARGUMENT",
        "Android metastate must be a non-negative integer.",
      );
    }
    await this.requestValue(
      fence,
      "POST",
      this.sessionPath(fence, "appium/device/press_keycode"),
      metastate === undefined ? { keycode } : { keycode, metastate },
      EmptyValueResponseSchema,
    );
  }

  public async typeText(fence: SessionFence, text: string): Promise<void> {
    if (text.length === 0 || text.length > MAX_TEXT_INPUT_LENGTH) {
      throw new AppiumW3cClientError(
        "INVALID_ARGUMENT",
        `Text input must contain 1-${String(MAX_TEXT_INPUT_LENGTH)} characters.`,
      );
    }
    await this.requestValue(
      fence,
      "POST",
      this.sessionPath(fence, "appium/device/keys"),
      { text },
      EmptyValueResponseSchema,
    );
  }

  public async currentPackage(fence: SessionFence): Promise<string> {
    return await this.requestValue(
      fence,
      "GET",
      this.sessionPath(fence, "appium/device/current_package"),
      undefined,
      StringValueResponseSchema,
    );
  }

  public async currentActivity(fence: SessionFence): Promise<string> {
    return await this.requestValue(
      fence,
      "GET",
      this.sessionPath(fence, "appium/device/current_activity"),
      undefined,
      StringValueResponseSchema,
    );
  }

  public async updateSettings(
    fence: SessionFence,
    settings: Record<string, string | number | boolean>,
  ): Promise<void> {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success)
      throw new AppiumW3cClientError("INVALID_ARGUMENT", "Invalid Appium settings.");
    await this.requestValue(
      fence,
      "POST",
      this.sessionPath(fence, "appium/settings"),
      { settings: parsed.data },
      EmptyValueResponseSchema,
    );
  }

  private async requestAppPackage(
    fence: SessionFence,
    operation: string,
    packageName: string,
  ): Promise<void> {
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      throw new AppiumW3cClientError("INVALID_ARGUMENT", "Android package name is invalid.");
    }
    await this.requestValue(
      fence,
      "POST",
      this.sessionPath(fence, `appium/device/${operation}`),
      { appId: packageName },
      EmptyValueResponseSchema,
    );
  }

  private sessionPath(fence: SessionFence, suffix: string): string {
    this.assertFence(fence);
    const encoded = encodeURIComponent(fence.sessionId);
    return `/session/${encoded}${suffix.length === 0 ? "" : `/${suffix}`}`;
  }

  private assertFence(fence: SessionFence): void {
    const active = this.activeFence;
    if (
      active === undefined ||
      active.sessionId !== fence.sessionId ||
      active.serial !== fence.serial ||
      active.generation !== fence.generation ||
      fence.serial !== this.serial ||
      fence.generation !== this.generation
    ) {
      throw new AppiumW3cClientError(
        "FENCE_MISMATCH",
        "Appium response belongs to a stale session, serial, or worker generation.",
      );
    }
  }

  private async requestValue<T>(
    fence: SessionFence,
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<{ value: T }>,
  ): Promise<T> {
    this.assertFence(fence);
    const responseBody = await this.requestBody(method, path, body, schema, fence);
    return responseBody.value;
  }

  private async requestBody<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    expectedFence?: SessionFence,
  ): Promise<T> {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const code =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "NETWORK_ERROR";
      throw new AppiumW3cClientError(code, `Appium ${method} ${path} request failed.`, {
        cause: error,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.lastTiming = {
      method,
      path,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: response.status,
    };
    if (bytes.byteLength > this.maxResponseBytes) {
      throw new AppiumW3cClientError(
        "RESPONSE_TOO_LARGE",
        `Appium response exceeded ${String(this.maxResponseBytes)} bytes.`,
        { httpStatus: response.status },
      );
    }
    const text = new TextDecoder().decode(bytes);
    let raw: unknown;
    try {
      raw = text.length === 0 ? { value: null } : JSON.parse(text);
    } catch (error) {
      throw new AppiumW3cClientError("PROTOCOL_ERROR", "Appium returned invalid JSON.", {
        cause: error,
        httpStatus: response.status,
      });
    }
    const appiumError = getAppiumError(raw);
    if (!response.ok || appiumError !== undefined) {
      throw createAppiumError(response.status, appiumError);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new AppiumW3cClientError(
        "PROTOCOL_ERROR",
        "Appium response did not match the expected schema.",
        { cause: parsed.error, httpStatus: response.status },
      );
    }
    if (expectedFence !== undefined) assertResponseFence(response, raw, expectedFence);
    return parsed.data;
  }
}

function assertResponseFence(response: Response, body: unknown, expected: SessionFence): void {
  const sessionId = response.headers.get("x-test-center-session-id");
  const serial = response.headers.get("x-test-center-serial");
  const generation = response.headers.get("x-test-center-generation");
  if (sessionId !== null && sessionId !== expected.sessionId) {
    throw new AppiumW3cClientError("FENCE_MISMATCH", "Appium response session fence mismatch.");
  }
  if (serial !== null && serial !== expected.serial) {
    throw new AppiumW3cClientError("FENCE_MISMATCH", "Appium response serial fence mismatch.");
  }
  if (generation !== null && generation !== String(expected.generation)) {
    throw new AppiumW3cClientError(
      "FENCE_MISMATCH",
      "Appium response worker generation fence mismatch.",
    );
  }
  if (typeof body === "object" && body !== null && "sessionId" in body) {
    const bodySessionId = (body as { sessionId?: unknown }).sessionId;
    if (typeof bodySessionId === "string" && bodySessionId !== expected.sessionId) {
      throw new AppiumW3cClientError("FENCE_MISMATCH", "Appium response session id mismatch.");
    }
  }
}

function toW3cCapabilities(capabilities: DeviceSessionCapabilities): Record<string, unknown> {
  return {
    platformName: capabilities.platformName,
    "appium:automationName": capabilities.automationName,
    "appium:udid": capabilities.udid,
    "appium:systemPort": capabilities.systemPort,
    "appium:mjpegServerPort": capabilities.mjpegServerPort,
    "appium:noReset": capabilities.noReset,
    "appium:newCommandTimeout": capabilities.newCommandTimeout,
  };
}

function getAppiumError(
  value: unknown,
): { readonly error: string; readonly message?: string } | undefined {
  if (typeof value !== "object" || value === null || !("value" in value)) return undefined;
  const nested = (value as { value?: unknown }).value;
  if (typeof nested !== "object" || nested === null || !("error" in nested)) return undefined;
  const error = (nested as { error?: unknown }).error;
  if (typeof error !== "string") return undefined;
  const message = (nested as { message?: unknown }).message;
  return { error, ...(typeof message === "string" ? { message } : {}) };
}

function createAppiumError(
  status: number,
  detail: { readonly error: string; readonly message?: string } | undefined,
): AppiumW3cClientError {
  const code: AppiumW3cClientErrorCode =
    detail?.error === "invalid session id" || status === 404
      ? "SESSION_NOT_FOUND"
      : detail === undefined
        ? "HTTP_ERROR"
        : "APPIUM_ERROR";
  return new AppiumW3cClientError(
    code,
    detail?.message ?? `Appium request failed with HTTP ${String(status)}.`,
    { httpStatus: status },
  );
}
