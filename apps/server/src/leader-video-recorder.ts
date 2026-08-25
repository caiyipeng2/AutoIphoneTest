import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, win32 } from "node:path";

import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";
import type {
  EvidencePublicationService,
  EvidenceRecord,
  EvidenceRepository,
} from "@test-center/evidence";
import { ScrcpyPrimaryProcess, type ScrcpyRecordFormat } from "@test-center/video";

const LEADER_VIDEO_ATTEMPT = 1;
const DEFAULT_RECORD_FORMAT: ScrcpyRecordFormat = "mp4";

export interface LeaderVideoRecorderProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface LeaderVideoRecorderProcessInput {
  readonly serial: DeviceSerial;
  readonly executablePath: string;
  readonly recordPath: string;
  readonly recordFormat: ScrcpyRecordFormat;
}

export interface LeaderVideoRecorderOptions {
  readonly runRoot: string;
  readonly executablePath: string;
  readonly evidenceRepository: EvidenceRepository;
  readonly publicationService?: EvidencePublicationService;
  readonly publicationServiceFactory?: (runId: string) => EvidencePublicationService;
  readonly processFactory?: (input: LeaderVideoRecorderProcessInput) => LeaderVideoRecorderProcess;
  readonly recordFormat?: ScrcpyRecordFormat;
  readonly now?: () => string;
}

export interface LeaderVideoStartInput {
  readonly runId: string;
  readonly serial: string;
  readonly enabled: boolean;
}

export interface LeaderVideoStopResult {
  readonly state: "READY" | "FAILED";
  readonly evidence: EvidenceRecord;
}

interface ActiveRecording {
  readonly runId: string;
  readonly evidenceId: string;
  readonly recordPath: string;
  readonly finalRelativePath: string;
  readonly process: LeaderVideoRecorderProcess;
  readonly publicationService: EvidencePublicationService;
}

/**
 * Owns the optional leader-only scrcpy recording for one active session.
 *
 * The process writes a run-local partial file. Only after the process has
 * stopped and the file has a positive size does EvidencePublicationService
 * atomically publish the final video artifact and transition the durable VIDEO record to
 * READY. Recording failures are deliberately returned as evidence failures so
 * they never turn an otherwise valid action run into a session failure.
 */
export class LeaderVideoRecorder {
  private readonly runRoot: string;
  private readonly executablePath: string;
  private readonly evidenceRepository: EvidenceRepository;
  private readonly publicationServiceFactory: (runId: string) => EvidencePublicationService;
  private readonly processFactory: (
    input: LeaderVideoRecorderProcessInput,
  ) => LeaderVideoRecorderProcess;
  private readonly recordFormat: ScrcpyRecordFormat;
  private readonly now: () => string;
  private active: ActiveRecording | undefined;

  public constructor(options: LeaderVideoRecorderOptions) {
    if (!win32.isAbsolute(options.runRoot)) throw new TypeError("runRoot must be absolute.");
    if (!options.executablePath.trim()) throw new TypeError("scrcpy executable path is required.");
    this.runRoot = win32.normalize(options.runRoot);
    this.executablePath = options.executablePath;
    this.evidenceRepository = options.evidenceRepository;
    if (
      options.publicationService === undefined &&
      options.publicationServiceFactory === undefined
    ) {
      throw new TypeError("A video publication service or factory is required.");
    }
    this.publicationServiceFactory =
      options.publicationServiceFactory ?? (() => options.publicationService!);
    this.processFactory = options.processFactory ?? createScrcpyProcess;
    this.recordFormat = options.recordFormat ?? DEFAULT_RECORD_FORMAT;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async start(input: LeaderVideoStartInput): Promise<void> {
    if (!input.enabled) return;
    if (this.active !== undefined) throw new Error("A leader video recording is already active.");
    const serial = parseDeviceSerial(input.serial);
    const runSegment = safeRunSegment(input.runId);
    const evidenceId = `video-${runSegment}-leader`;
    const tempRelativePath = `video/leader.${this.recordFormat}.partial`;
    const finalRelativePath = `video/leader.${this.recordFormat}`;
    const recordPath = resolveInside(win32.join(this.runRoot, runSegment), tempRelativePath);
    await mkdir(dirname(recordPath), { recursive: true });

    this.evidenceRepository.create({
      id: evidenceId,
      runId: input.runId,
      serial,
      kind: "VIDEO",
      tempRelativePath,
      attempt: LEADER_VIDEO_ATTEMPT,
    });

    try {
      const process = this.processFactory({
        serial,
        executablePath: this.executablePath,
        recordPath,
        recordFormat: this.recordFormat,
      });
      await process.start();
      this.active = {
        runId: input.runId,
        evidenceId,
        recordPath,
        finalRelativePath,
        process,
        publicationService: this.publicationServiceFactory(input.runId),
      };
    } catch {
      this.evidenceRepository.markFailed(evidenceId, { category: "START_FAILED" });
      await rm(recordPath, { force: true }).catch(() => undefined);
    }
  }

  public async stop(runId: string): Promise<LeaderVideoStopResult | undefined> {
    const active = this.active;
    if (active === undefined || active.runId !== runId) return undefined;
    this.active = undefined;

    try {
      await active.process.stop();
      const recorded = await stat(active.recordPath);
      if (!recorded.isFile() || recorded.size <= 0) throw new Error("Recording is empty.");
      const evidence = await active.publicationService.publish(active.evidenceId, {
        relativePath: active.finalRelativePath,
        attempt: LEADER_VIDEO_ATTEMPT,
        content: fileChunks(active.recordPath),
        capturedAt: this.now(),
      });
      await rm(active.recordPath, { force: true });
      return { state: "READY", evidence };
    } catch (error) {
      const current = this.evidenceRepository.get(active.evidenceId);
      if (current?.state === "PENDING") {
        this.evidenceRepository.markFailed(active.evidenceId, {
          category: classifyStopFailure(error),
        });
      }
      await rm(active.recordPath, { force: true }).catch(() => undefined);
      const failed = this.evidenceRepository.get(active.evidenceId);
      if (failed === undefined) {
        throw new Error("Leader video evidence disappeared after stop.", { cause: error });
      }
      return { state: "FAILED", evidence: failed };
    }
  }

  public async stopAll(): Promise<void> {
    const active = this.active;
    if (active !== undefined) await this.stop(active.runId);
  }
}

function createScrcpyProcess(input: LeaderVideoRecorderProcessInput): LeaderVideoRecorderProcess {
  return new ScrcpyPrimaryProcess({
    serial: input.serial,
    executablePath: input.executablePath,
    recordPath: input.recordPath,
    recordFormat: input.recordFormat,
  });
}

async function* fileChunks(filePath: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(filePath)) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

function classifyStopFailure(error: unknown): string {
  if (error instanceof Error && error.message === "Recording is empty.") return "EMPTY_RECORDING";
  if (error !== null && error !== undefined && typeof error === "object" && "code" in error) {
    if (error.code === "ENOENT") return "RECORDING_MISSING";
  }
  return "STOP_FAILED";
}

function safeRunSegment(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new TypeError("runId cannot be used as a storage path.");
  }
  return runId;
}

function resolveInside(rootPath: string, relativePath: string): string {
  const root = win32.normalize(rootPath);
  const absolute = win32.resolve(root, relativePath.replaceAll("/", "\\"));
  if (absolute !== root && !absolute.startsWith(`${root}\\`)) {
    throw new TypeError("relative path must stay inside the run root.");
  }
  return absolute;
}
