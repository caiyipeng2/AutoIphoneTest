import { win32 } from "node:path";
import { join } from "node:path";

import { AdbClient, LogcatStream } from "@test-center/adb";
import { createRuntimeBridgeSession } from "./runtime-bridge.js";
import {
  ArtifactMetadataParser,
  collectInstalledIdentity,
  createAdbInstalledIdentityExecutor,
  createApksignerSignerResolver,
  ArtifactRepository,
  ContentStore,
  type StagedContent,
} from "@test-center/artifacts";
import {
  ArtifactImportProvider,
  type ArtifactImportFileRequest,
  type ArtifactImportService,
} from "@test-center/build-provider";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";
import type Database from "better-sqlite3";
import {
  ARTIFACTS_MIGRATION,
  configureDatabase,
  DEVICES_MIGRATION,
  DEPLOYMENTS_MIGRATION,
  DEPLOYMENT_CONTROLS_MIGRATION,
  EVIDENCE_REPORTS_MIGRATION,
  OPTIONAL_REPORT_EXPORTS_MIGRATION,
  INSTALL_SETS_MIGRATION,
  RUN_ACTIONS_MIGRATION,
  SESSION_API_MIGRATION,
  ACTION_COMMANDS_MIGRATION,
  INCIDENTS_MIGRATION,
  RUN_MEMBERSHIP_MIGRATION,
  RUN_FAILURE_POLICY_MIGRATION,
  UID_BRIDGE_MIGRATION,
  REPORT_FINALIZATION_MIGRATION,
  CLEANUP_CONFIRMATIONS_MIGRATION,
  CLEANUP_AUDIT_MIGRATION,
  CLEANUP_PROTECTION_MIGRATION,
  ensureRuntimeDirectories,
  FOUNDATION_MIGRATION,
  migrate,
  openDatabase,
  createRuntimePaths,
} from "@test-center/database";
import {
  createAdbDiscoverySource,
  DeviceRegistry,
  DeviceRepository,
  UidService,
} from "@test-center/devices";
import { InstallationRepository } from "@test-center/devices";
import { DestructiveConfirmationService } from "@test-center/security";
import {
  ActionDispatcher,
  ActionOutbox,
  AppiumActionExecutor,
  AppiumPreflightProbe,
  DeviceConnectionFaultMonitor,
  IncidentMonitor,
  IncidentRepository,
  LogcatFaultMonitor,
  RuntimeFaultMonitor,
  RunActionRepository,
  RunMembershipIncidentExecutor,
  RunMembershipRepository,
  TextFocusBarrier,
  type AppiumActionFaultEvent,
} from "@test-center/sessions";
import type { IncidentRouteService } from "./routes/incidents.js";
import { DeviceWorker } from "@test-center/sessions";
import {
  AppiumService,
  AppiumW3cClient,
  JsonFilePortLeaseStore,
  PortAllocator,
} from "@test-center/appium";
import { WorkerResourceManager } from "@test-center/sessions";
import {
  DeploymentOrchestrator,
  type DeploymentArtifact,
  type DeploymentCreateInput,
} from "@test-center/deployments";
import type { DeploymentRouteService } from "./routes/deployments.js";
import type { ArtifactRouteService, InstalledRegistrationResult } from "./routes/artifacts.js";
import type { SessionRouteService } from "./routes/sessions.js";
import { RuntimeSessionRouteService } from "./session-runtime.js";
import { RuntimeWorkerCoordinator } from "./runtime-worker-coordinator.js";
import { parseBridgeMode, type BridgeMode } from "./runtime-config.js";
import {
  ExcelReportExporter,
  JunitReportExporter,
  ReportFinalizationExecutor,
  ReportFinalizationRecoveryService,
  ReportExportRepository,
  ReportExportService,
  ReportHistoryRepository,
  ReportSnapshotRepository,
  PdfReportExporter,
} from "@test-center/reports";
import { RuntimeResultsRouteService } from "./results-runtime.js";
import {
  AtomicEvidencePublisher,
  CleanupAuditRepository,
  CleanupExecutionService,
  CleanupPreviewRepository,
  CleanupTrashMover,
  EvidencePublicationService,
  EvidenceRepository,
  createFileSystemFreeSpaceSource,
  StoragePressureMonitor,
  StoragePressurePoller,
} from "@test-center/evidence";
import { CleanupConfirmationService } from "@test-center/security";
import type { CleanupRouteService } from "./routes/cleanup.js";
import type { StorageOverviewRouteService } from "./routes/storage.js";
import { createStorageOverviewService } from "./storage-runtime.js";
import {
  createConfiguredRuntimeVideoCoordinator,
  type RuntimeVideoCoordinator,
} from "./runtime-video.js";
import { LeaderVideoRecorder } from "./leader-video-recorder.js";

export interface RuntimeDeviceRegistry {
  readonly registry: DeviceRegistry;
  readonly artifactService: ArtifactRouteService;
  readonly deploymentService: DeploymentRouteService;
  readonly uidService: UidService;
  readonly sessionService: SessionRouteService;
  readonly workerCoordinator: RuntimeWorkerCoordinator;
  readonly faultMonitor: DeviceConnectionFaultMonitor;
  readonly logcatFaultMonitor: LogcatFaultMonitor;
  readonly runtimeFaultMonitor: RuntimeFaultMonitor;
  readonly incidentService: IncidentRouteService;
  readonly resultsService: RuntimeResultsRouteService;
  readonly resultsExportRoot: string;
  readonly cleanupService: CleanupRouteService;
  readonly storageService: StorageOverviewRouteService;
  readonly viewProviders?: ReadonlyMap<string, import("@test-center/video").ViewProvider>;
  readonly videoCoordinator?: RuntimeVideoCoordinator;
  readonly close: () => Promise<void>;
}

export async function createRuntimeDeviceRegistry(
  projectRoot: string,
): Promise<RuntimeDeviceRegistry> {
  const paths = createRuntimePaths(projectRoot, process.env.TEST_CENTER_DATA_ROOT);
  await ensureRuntimeDirectories(paths);
  const database = openDatabase(paths);
  configureDatabase(database);
  migrate(database, [
    FOUNDATION_MIGRATION,
    DEVICES_MIGRATION,
    ARTIFACTS_MIGRATION,
    DEPLOYMENTS_MIGRATION,
    INSTALL_SETS_MIGRATION,
    DEPLOYMENT_CONTROLS_MIGRATION,
    UID_BRIDGE_MIGRATION,
    RUN_ACTIONS_MIGRATION,
    SESSION_API_MIGRATION,
    ACTION_COMMANDS_MIGRATION,
    INCIDENTS_MIGRATION,
    RUN_MEMBERSHIP_MIGRATION,
    RUN_FAILURE_POLICY_MIGRATION,
    EVIDENCE_REPORTS_MIGRATION,
    REPORT_FINALIZATION_MIGRATION,
    CLEANUP_CONFIRMATIONS_MIGRATION,
    CLEANUP_AUDIT_MIGRATION,
    CLEANUP_PROTECTION_MIGRATION,
    OPTIONAL_REPORT_EXPORTS_MIGRATION,
  ]);
  const reportRecovery = new ReportFinalizationRecoveryService(database);
  await reportRecovery.reconcileOrphanedPartials(paths.runsRoot);
  reportRecovery.reconcileStale();
  const historyRepository = new ReportHistoryRepository(database);
  const finalizationExecutor = new ReportFinalizationExecutor(database, {
    runRoot: paths.runsRoot,
  });
  const evidenceRepository = new EvidenceRepository(database, { runRoot: paths.runsRoot });
  const leaderVideoRecorder = new LeaderVideoRecorder({
    runRoot: paths.runsRoot,
    executablePath:
      process.env.TEST_CENTER_SCRCPY_EXECUTABLE_PATH ??
      win32.join(projectRoot, "tools", "scrcpy", "3.1", "scrcpy.exe"),
    evidenceRepository,
    publicationServiceFactory: (runId) =>
      new EvidencePublicationService(
        evidenceRepository,
        new AtomicEvidencePublisher({ runRoot: win32.join(paths.runsRoot, runId) }),
      ),
  });
  const reportSnapshotRepository = new ReportSnapshotRepository(database);
  const optionalExportService = new ReportExportService({
    repository: new ReportExportRepository(database, { runRoot: paths.runsRoot }),
    runRoot: paths.runsRoot,
    loadModel: (runId) => reportSnapshotRepository.load(runId),
    publishers: {
      EXCEL: new ExcelReportExporter(),
      PDF: new PdfReportExporter(),
      JUNIT: new JunitReportExporter(),
    },
  });
  const resultsService = new RuntimeResultsRouteService(
    historyRepository,
    finalizationExecutor,
    optionalExportService,
  );
  const cleanupRepository = new CleanupAuditRepository(database);
  const cleanupPreviewRepository = new CleanupPreviewRepository(database);
  const cleanupConfirmation = new CleanupConfirmationService(database);
  const cleanupExecution = new CleanupExecutionService(
    cleanupRepository,
    cleanupConfirmation,
    new CleanupTrashMover(),
  );
  const cleanupService: CleanupRouteService = {
    issueConfirmation: (target) => cleanupConfirmation.issue(target),
    execute: async (input) =>
      await cleanupExecution.execute({
        ...input,
        runsRoot: paths.runsRoot,
        trashRoot: win32.join(paths.dataRoot, "trash"),
      }),
    listEvents: (cleanupId) => cleanupRepository.listEvents(cleanupId),
    preview: (retentionDays) => ({
      retentionDays,
      preview: cleanupPreviewRepository.preview(retentionDays, new Date().toISOString()),
    }),
  };
  const storageMonitor = new StoragePressureMonitor(
    createFileSystemFreeSpaceSource(paths.dataRoot),
  );
  const storagePoller = new StoragePressurePoller(storageMonitor, {
    intervalMs: readPositiveInteger(process.env.TEST_CENTER_STORAGE_POLL_INTERVAL_MS, 30_000),
  });
  const storageService = createStorageOverviewService(database, storageMonitor);
  // Sampling is intentionally best-effort during startup. The authenticated
  // Overview request can retry on demand when a filesystem provider is slow or
  // temporarily unavailable, while the poller keeps normal dashboards fresh.
  void storagePoller.start().catch(() => undefined);
  const adbPath =
    process.env.TEST_CENTER_ADB_PATH ??
    "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe";
  const client = new AdbClient({ adbPath, cwd: projectRoot });
  const artifactService = new RuntimeArtifactRouteService(
    database,
    new ContentStore({ rootPath: paths.artifactsRoot }),
    client,
    projectRoot,
    paths.tempRoot,
  );
  const registry = new DeviceRegistry(
    new DeviceRepository(database),
    createAdbDiscoverySource(client),
  );
  const bridgeMode = parseBridgeMode(process.env);
  const workerCoordinator = createRuntimeWorkerCoordinator(
    paths,
    projectRoot,
    adbPath,
    registry,
    bridgeMode,
  );
  const videoCoordinator = createConfiguredRuntimeVideoCoordinator({
    registry,
    projectRoot,
    adbPath,
    getScreenshotCapture: (serial) =>
      readRunningScreenshotCapture(database, workerCoordinator, serial),
  });
  const uidService = new UidService(database);
  const actionRepository = new RunActionRepository(database);
  const actionOutbox = new ActionOutbox(database);
  const sessionService = new RuntimeSessionRouteService(
    database,
    registry,
    createConfiguredPreflightProbe(),
    actionRepository,
    createConfiguredActionDispatcher(
      actionRepository,
      actionOutbox,
      registry,
      workerCoordinator,
      bridgeMode,
    ),
    workerCoordinator,
    actionOutbox,
    finalizationExecutor,
    leaderVideoRecorder,
  );
  const incidentMonitor = new IncidentMonitor(
    new IncidentRepository(database),
    new RunMembershipIncidentExecutor(new RunMembershipRepository(database), {
      pauseAll: async (runId, reason) => {
        await sessionService.pause(runId, reason);
      },
    }),
  );
  const incidentRepository = new IncidentRepository(database);
  const incidentService: IncidentRouteService = {
    getTimeline: (runId) => {
      const session = sessionService.get(runId);
      if (session === undefined) return undefined;
      return {
        runId,
        incidents: incidentRepository.list(runId),
        recoveries: incidentRepository.listRecoveries(runId),
      };
    },
  };
  const faultMonitor = new DeviceConnectionFaultMonitor({
    subscribe: (listener) =>
      registry.subscribe((event) => {
        if (event.type !== "device.connectionChanged") return;
        listener({
          serial: event.device.serial,
          state: event.device.state,
          connectionSeq: event.device.connectionSeq,
          observedAt: event.device.lastSeenAt,
        });
      }),
    listRuns: () => readRunningFaultRuns(database),
    handleIncident: async (input) => await incidentMonitor.handle(input),
  });
  const logcatFaultMonitor = new LogcatFaultMonitor({
    subscribe: (listener) => workerCoordinator.subscribeLogcat(listener),
    listRuns: () => readRunningLogcatFaultRuns(database),
    handleIncident: async (input) => await incidentMonitor.handle(input),
  });
  const runtimeFaultMonitor = new RuntimeFaultMonitor({
    subscribe: (listener) => workerCoordinator.subscribeFault(listener),
    listRuns: () => readRunningLogcatFaultRuns(database),
    handleIncident: async (input) => await incidentMonitor.handle(input),
  });
  const deploymentService = new RuntimeDeploymentRouteService(
    database,
    registry,
    artifactService,
    client,
    paths.artifactsRoot,
  );
  return {
    registry,
    artifactService,
    deploymentService,
    uidService,
    sessionService,
    workerCoordinator,
    faultMonitor,
    logcatFaultMonitor,
    runtimeFaultMonitor,
    incidentService,
    resultsService,
    resultsExportRoot: paths.runsRoot,
    cleanupService,
    storageService,
    ...(videoCoordinator === undefined
      ? {}
      : { viewProviders: videoCoordinator.providers, videoCoordinator }),
    close: async () => {
      await storagePoller.stop();
      await leaderVideoRecorder.stopAll().catch(() => undefined);
      await videoCoordinator?.close();
      await workerCoordinator.stopAll().catch(() => undefined);
      database.close();
    },
  };
}

function readRunningScreenshotCapture(
  database: Database.Database,
  workerCoordinator: Pick<RuntimeWorkerCoordinator, "getScreenshotCapture">,
  serial: DeviceSerial,
) {
  const runs = database
    .prepare(
      `SELECT r.id
       FROM test_runs r
       JOIN run_devices d ON d.run_id = r.id AND d.epoch = r.current_epoch
       WHERE r.state = 'RUNNING' AND d.serial = ? AND d.membership_state = 'ACTIVE'
       ORDER BY r.id ASC`,
    )
    .all(serial) as readonly { id: string }[];
  if (runs.length !== 1) return undefined;
  return workerCoordinator.getScreenshotCapture(runs[0]!.id, serial);
}

function readRunningLogcatFaultRuns(database: Database.Database) {
  const runs = database
    .prepare(
      "SELECT id, current_epoch, failure_policy FROM test_runs WHERE state = 'RUNNING' ORDER BY id ASC",
    )
    .all() as readonly {
    id: string;
    current_epoch: number;
    failure_policy: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  }[];
  return runs.flatMap((run) => {
    const members = database
      .prepare(
        `SELECT serial, role, membership_state
         FROM run_devices WHERE run_id = ? AND epoch = ?
         ORDER BY role = 'LEADER' DESC, serial ASC`,
      )
      .all(run.id, run.current_epoch) as readonly {
      serial: string;
      role: "LEADER" | "FOLLOWER";
      membership_state: "ACTIVE" | "RECOVERING" | "QUARANTINED" | "LEFT";
    }[];
    return members
      .filter((member) => member.membership_state === "ACTIVE")
      .map((member) => ({
        runId: run.id,
        serial: member.serial,
        policy: run.failure_policy,
        members: members.map((item) => ({
          serial: item.serial,
          role: item.role,
          membershipState: item.membership_state,
        })),
      }));
  });
}

function readRunningFaultRuns(database: Database.Database) {
  const runs = database
    .prepare(
      "SELECT id, current_epoch, failure_policy FROM test_runs WHERE state = 'RUNNING' ORDER BY id ASC",
    )
    .all() as readonly {
    id: string;
    current_epoch: number;
    failure_policy: "PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE";
  }[];
  return runs.map((run) => ({
    runId: run.id,
    policy: run.failure_policy,
    members: database
      .prepare(
        `SELECT serial, role, membership_state
         FROM run_devices WHERE run_id = ? AND epoch = ?
         ORDER BY role = 'LEADER' DESC, serial ASC`,
      )
      .all(run.id, run.current_epoch)
      .map((member) => {
        const row = member as {
          serial: string;
          role: "LEADER" | "FOLLOWER";
          membership_state: "ACTIVE" | "RECOVERING" | "QUARANTINED" | "LEFT";
        };
        return {
          serial: row.serial,
          role: row.role,
          membershipState: row.membership_state === "RECOVERING" ? "RECOVERING" : "ACTIVE",
        } as const;
      })
      .filter((member) => member.membershipState === "ACTIVE"),
  }));
}

function createRuntimeWorkerCoordinator(
  paths: ReturnType<typeof createRuntimePaths>,
  projectRoot: string,
  adbPath: string,
  registry: DeviceRegistry,
  bridgeMode: BridgeMode,
): RuntimeWorkerCoordinator {
  const ownerPid = process.pid;
  const client = new AdbClient({ adbPath, cwd: projectRoot });
  const allocator = new PortAllocator({
    store: new JsonFilePortLeaseStore(join(paths.dataRoot, "port-leases.json")),
    ranges: {
      appium: { start: 4723, end: 4730 },
      system: { start: 8200, end: 8207 },
      mjpeg: { start: 7810, end: 7817 },
    },
  });
  const resources = new WorkerResourceManager({
    allocator,
    bridgeRange: { start: 17501, end: 17508 },
    rootPath: paths.runsRoot,
    ownerPid,
  });
  // Spawn Node directly on Windows. The .cmd shim cannot be launched with
  // shell:false, which is required by AppiumService for predictable process
  // ownership and cleanup. Environment overrides keep portable toolchains
  // possible while the default uses the Node runtime executing this server.
  const appiumExecutable = process.env.TEST_CENTER_APPIUM_NODE ?? process.execPath;
  const appiumEntry =
    process.env.TEST_CENTER_APPIUM_ENTRY ??
    win32.join(projectRoot, "node_modules", "appium", "build", "lib", "main.js");
  const appiumHome =
    process.env.TEST_CENTER_APPIUM_HOME ?? win32.join(paths.dataRoot, "appium-home");
  const bridgeForwarder = {
    add: async (serial: string, hostPort: number, devicePort: number) => {
      assertAdbSuccess(
        await client.execute({
          kind: "forwardAdd",
          serial: parseDeviceSerial(serial),
          hostPort,
          devicePort,
        }),
        "ADB bridge forward add",
      );
    },
    remove: async (serial: string, hostPort: number) => {
      assertAdbSuccess(
        await client.execute({
          kind: "forwardRemove",
          serial: parseDeviceSerial(serial),
          hostPort,
        }),
        "ADB bridge forward remove",
      );
    },
  };
  return new RuntimeWorkerCoordinator(
    ({ runId, serial, packageName, runNonceHash, logcatRecordSink, faultSink }) => {
      const workerOwner = { ownerPid, ownerToken: `server-${String(ownerPid)}` };
      const bridgeOptions =
        bridgeMode === "REQUIRED"
          ? {
              bridgeForwarder,
              bridgeSessionFactory: ({
                hostPort,
                runNonceHash: workerNonce,
              }: {
                readonly hostPort: number;
                readonly runNonceHash?: string;
              }) => {
                if (workerNonce === undefined)
                  throw new Error("Managed worker run nonce is required.");
                return createRuntimeBridgeSession({ hostPort, runNonceHash: workerNonce });
              },
            }
          : {};
      return new DeviceWorker({
        serial,
        packageName,
        owner: workerOwner,
        runId,
        resourceManager: resources,
        ...bridgeOptions,
        runNonceHash,
        actionViewport: readDeviceViewport(registry.get(serial)?.metadata),
        allocator,
        identityProbe: async () => {
          const device = registry.get(serial);
          if (device === undefined || device.state !== "ONLINE")
            throw new Error(`Device must be online: ${serial}.`);
          return { serial, packageName };
        },
        clientFactory: ({ serial: clientSerial, generation, baseUrl }) =>
          new AppiumW3cClient({ baseUrl, serial: clientSerial, generation }),
        appiumServiceFactory: ({ port, logPath }) =>
          new AppiumService({
            executablePath: appiumExecutable,
            executableArgs: [appiumEntry],
            appiumHome,
            port,
            logPath: win32.join(logPath, "appium.log"),
            // UiAutomator2 may install/validate its device-side server on a
            // cold Android device. Keep this bounded but long enough for two
            // sequential workers to initialize without a false timeout.
            readinessTimeoutMs: readPositiveInteger(
              process.env.TEST_CENTER_APPIUM_READINESS_TIMEOUT_MS,
              60_000,
            ),
            cwd: projectRoot,
          }),
        logcatFactory: ({ serial: logSerial, resourceLease }) =>
          new LogcatStream({
            serial: logSerial,
            adbPath,
            cwd: projectRoot,
            runDirectory: resourceLease?.paths.logs ?? paths.logsRoot,
            recordSink: logcatRecordSink,
          }),
        logcatRecordSink,
        faultSink,
      });
    },
  );
}

function createConfiguredPreflightProbe(): AppiumPreflightProbe | undefined {
  const baseUrl = process.env.TEST_CENTER_APPIUM_URL;
  if (baseUrl === undefined || baseUrl.trim() === "") return undefined;
  const systemPort = Number(process.env.TEST_CENTER_APPIUM_SYSTEM_PORT ?? 8201);
  const mjpegServerPort = Number(process.env.TEST_CENTER_APPIUM_MJPEG_PORT ?? 7811);
  return new AppiumPreflightProbe({ baseUrl, systemPort, mjpegServerPort });
}

function createConfiguredActionDispatcher(
  actionRepository: RunActionRepository,
  actionOutbox: ActionOutbox,
  registry: DeviceRegistry,
  workerCoordinator: Pick<
    RuntimeWorkerCoordinator,
    "getActionBarrier" | "getTextFocusSnapshot" | "getActionExecutor" | "publishFault"
  >,
  bridgeMode: BridgeMode,
): ActionDispatcher | undefined {
  const baseUrl = process.env.TEST_CENTER_APPIUM_URL?.trim();
  const systemPort = Number(process.env.TEST_CENTER_APPIUM_SYSTEM_PORT ?? 8201);
  const mjpegServerPort = Number(process.env.TEST_CENTER_APPIUM_MJPEG_PORT ?? 7811);
  const viewport = {
    width: readPositiveInteger(process.env.TEST_CENTER_APPIUM_VIEWPORT_WIDTH, 1080),
    height: readPositiveInteger(process.env.TEST_CENTER_APPIUM_VIEWPORT_HEIGHT, 2340),
  };
  const serialPortIndexes = new Map<string, number>(
    registry
      .list()
      .map((device) => device.serial)
      .sort()
      .map((serial, index) => [serial, index] as const),
  );
  const barrierFactory =
    bridgeMode === "REQUIRED"
      ? (serial: string, runId?: string) => {
          if (runId === undefined)
            throw new Error("Action run id is required for bridge dispatch.");
          const barrier = workerCoordinator.getActionBarrier(runId, parseDeviceSerial(serial));
          if (barrier === undefined) throw new Error(`Worker bridge is not ready: ${serial}.`);
          return barrier;
        }
      : undefined;
  const textFocusBarrier =
    bridgeMode === "REQUIRED"
      ? new TextFocusBarrier({
          sample: async (serial, runId) => {
            if (runId === undefined) throw new Error("Text action run id is required.");
            const snapshot = workerCoordinator.getTextFocusSnapshot(
              runId,
              parseDeviceSerial(serial),
            );
            if (snapshot === undefined)
              throw new Error(`Worker bridge state is not ready: ${serial}.`);
            return snapshot;
          },
        })
      : undefined;
  const executorFactory =
    baseUrl === undefined
      ? (serial: string) => ({
          execute: (input: {
            readonly runId?: string;
            readonly actionId?: string;
            readonly serial: string;
            readonly packageName: string;
            readonly payload?: import("@test-center/sessions").ActionPayload;
            readonly command?: import("@test-center/sessions").ActionCommand;
          }) => {
            if (input.runId === undefined) throw new Error("Managed action run id is required.");
            const executor = workerCoordinator.getActionExecutor(
              input.runId,
              parseDeviceSerial(serial),
            );
            if (executor === undefined) throw new Error(`Worker is not ready: ${serial}.`);
            return executor.execute({
              packageName: input.packageName,
              ...(input.payload === undefined ? {} : { payload: input.payload }),
              ...(input.command === undefined ? {} : { command: input.command }),
            });
          },
        })
      : (serial: string) => {
          const portIndex = serialPortIndexes.get(serial) ?? 0;
          return new AppiumActionExecutor({
            baseUrl,
            systemPort: systemPort + portIndex,
            mjpegServerPort: mjpegServerPort + portIndex,
            viewport,
            faultSink: (event) => workerCoordinator.publishFault(toRuntimeFaultEvent(event)),
          });
        };
  return new ActionDispatcher(
    actionRepository,
    actionOutbox,
    executorFactory,
    `server-action-dispatcher-${process.pid}`,
    barrierFactory,
    textFocusBarrier,
  );
}

function toRuntimeFaultEvent(event: AppiumActionFaultEvent) {
  return {
    runId: event.runId,
    serial: event.serial,
    generation: 1,
    faultId: event.faultId,
    category: event.category,
    source: event.source,
    message: event.message,
    detectedAt: event.detectedAt,
    detectedAtRealtimeMs: event.detectedAtRealtimeMs,
  } as const;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 2 ? parsed : fallback;
}

function readDeviceViewport(metadata: Readonly<Record<string, unknown>> | undefined): {
  readonly width: number;
  readonly height: number;
} {
  const physicalSize = metadata?.physicalSize;
  if (typeof physicalSize !== "object" || physicalSize === null) {
    return { width: 1080, height: 2340 };
  }
  const width = (physicalSize as { width?: unknown }).width;
  const height = (physicalSize as { height?: unknown }).height;
  return typeof width === "number" &&
    typeof height === "number" &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 2 &&
    height >= 2
    ? { width, height }
    : { width: 1080, height: 2340 };
}

export interface RuntimeArtifactMetadataParser {
  parse(request: { readonly kind: "APK" | "AAB"; readonly artifactPath: string }): Promise<{
    readonly packageName?: string | undefined;
    readonly versionName?: string | undefined;
    readonly versionCode?: number | undefined;
    readonly signerSha256?: string | undefined;
  }>;
}

export class RuntimeArtifactRouteService implements ArtifactRouteService {
  public readonly provider: ArtifactImportProvider;
  private readonly repository: ArtifactRepository;
  private readonly installedExecutor;
  private readonly metadataParser: RuntimeArtifactMetadataParser;

  public constructor(
    database: Database.Database,
    private readonly store: ContentStore,
    client: AdbClient,
    projectRoot: string,
    tempRoot: string,
    metadataParser?: RuntimeArtifactMetadataParser,
  ) {
    this.repository = new ArtifactRepository(database, store);
    const javaPath =
      process.env.TEST_CENTER_JAVA_PATH ??
      win32.join(projectRoot, "tools", "java", "17.0.19+10", "bin", "java.exe");
    const apksignerPath =
      process.env.TEST_CENTER_APKSIGNER_PATH ??
      "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\apksigner.bat";
    const apksignerJarPath =
      process.env.TEST_CENTER_APKSIGNER_JAR_PATH ??
      "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\lib\\apksigner.jar";
    this.metadataParser =
      metadataParser ??
      new ArtifactMetadataParser({
        aapt2Path:
          process.env.TEST_CENTER_AAPT2_PATH ??
          "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\aapt2.exe",
        apksignerPath,
        apksignerJarPath,
        javaPath,
        bundletoolPath:
          process.env.TEST_CENTER_BUNDLETOOL_PATH ??
          win32.join(projectRoot, "tools", "bundletool", "1.18.3", "bundletool-all-1.18.3.jar"),
        jarsignerPath:
          process.env.TEST_CENTER_JARSIGNER_PATH ??
          win32.join(win32.dirname(javaPath), "jarsigner.exe"),
        cwd: projectRoot,
      });
    this.installedExecutor = createAdbInstalledIdentityExecutor(client, {
      signerSha256: createApksignerSignerResolver(client, {
        apksignerPath,
        javaPath,
        apksignerJarPath,
        cwd: projectRoot,
        tempRoot,
      }),
    });
    const importService: ArtifactImportService = {
      stage: async (request) => await this.stageFile(request),
      parse: async (request, staged) =>
        await this.metadataParser.parse({ kind: request.kind, artifactPath: staged.partialPath }),
      publish: async (staged, input) => await this.repository.publishSource(staged, input),
      discard: async (staged) => await this.removeStaged(staged),
    };
    this.provider = new ArtifactImportProvider(importService);
  }

  public list() {
    return [...this.repository.list(), ...this.repository.listInstalled()];
  }

  public get(id: string) {
    return this.repository.get(id);
  }

  public async registerInstalled(input: {
    readonly deviceSerial: DeviceSerial;
    readonly packageName: string;
  }): Promise<InstalledRegistrationResult> {
    const identity = await collectInstalledIdentity(
      input.deviceSerial,
      input.packageName,
      this.installedExecutor,
    );
    return this.repository.registerInstalled(identity);
  }

  public async collectIdentity(input: {
    readonly deviceSerial: DeviceSerial;
    readonly packageName: string;
  }) {
    return await collectInstalledIdentity(
      input.deviceSerial,
      input.packageName,
      this.installedExecutor,
    );
  }

  private async stageFile(request: ArtifactImportFileRequest): Promise<StagedContent> {
    const { createReadStream } = await import("node:fs");
    return await this.store.stage(createReadStream(request.artifactPath), request.originalName);
  }

  private async removeStaged(staged: StagedContent): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(staged.partialPath, { force: true });
  }
}

class RuntimeDeploymentRouteService implements DeploymentRouteService {
  private readonly orchestrator: DeploymentOrchestrator;
  private readonly installations: InstallationRepository;
  private readonly confirmations: DestructiveConfirmationService;

  public constructor(
    database: Database.Database,
    private readonly registry: DeviceRegistry,
    private readonly artifacts: RuntimeArtifactRouteService,
    private readonly client: AdbClient,
    private readonly artifactRoot: string,
  ) {
    this.installations = new InstallationRepository(database);
    this.confirmations = new DestructiveConfirmationService(database);
    this.orchestrator = new DeploymentOrchestrator(database, {
      artifact: (id) => this.resolveArtifact(id),
      deviceState: (serial) => this.registry.get(serial)?.state ?? "UNKNOWN",
      confirmations: this.confirmations,
      installation: this.installations,
      actions: {
        installApk: async ({ serial, artifact }) =>
          assertAdbSuccess(
            await this.client.execute({ kind: "installApk", serial, apkPath: artifact.storedPath }),
            "APK install",
          ),
        installAab: async () => {
          throw new Error("AAB deployment requires an explicit signing-profile runtime adapter.");
        },
        clearData: async ({ serial, packageName }) =>
          assertAdbSuccess(
            await this.client.execute({ kind: "clearPackageData", serial, packageName }),
            "clear package data",
          ),
        uninstallReinstall: async ({ serial, packageName }) =>
          assertAdbSuccess(
            await this.client.execute({ kind: "uninstallPackage", serial, packageName }),
            "uninstall package",
          ),
        collectIdentity: async ({ serial, packageName }) =>
          await this.artifacts.collectIdentity({ deviceSerial: serial, packageName }),
        startActivity: async ({ serial, packageName, activityName }) =>
          assertAdbSuccess(
            await this.client.execute({ kind: "startActivity", serial, packageName, activityName }),
            "start activity",
          ),
        foregroundActivity: async ({ serial }) =>
          (await this.client.execute({ kind: "foregroundActivity", serial })).stdout,
        packagePid: async ({ serial, packageName }) =>
          parsePid(await this.client.execute({ kind: "packagePid", serial, packageName })),
      },
    });
    this.orchestrator.recoverInterrupted();
  }

  public list() {
    return this.orchestrator.list();
  }
  public get(id: string) {
    return this.orchestrator.get(id);
  }
  public create(input: DeploymentCreateInput) {
    return this.orchestrator.create(input);
  }
  public run(id: string) {
    return this.orchestrator.run(id);
  }
  public cancel(id: string) {
    return this.orchestrator.cancel(id);
  }
  public retry(id: string) {
    return this.orchestrator.retry(id);
  }
  public subscribe(listener: Parameters<DeploymentOrchestrator["subscribe"]>[0]) {
    return this.orchestrator.subscribe(listener);
  }

  public issueConfirmation(input: Parameters<DeploymentRouteService["issueConfirmation"]>[0]) {
    const artifact = this.resolveArtifact(input.artifactId);
    if (artifact === undefined) throw new Error("Artifact not found.");
    this.installations.ensure(input.deviceSerial, artifact.packageName);
    const installation = this.installations.get(input.deviceSerial, artifact.packageName);
    return this.confirmations.issue({
      sessionId: input.sessionId,
      operationKind: input.operationKind,
      artifactId: input.artifactId,
      deviceSerial: input.deviceSerial,
      packageName: artifact.packageName,
      installGeneration: installation.installGeneration,
      appDataGeneration: installation.appDataGeneration,
    });
  }

  private resolveArtifact(id: string): DeploymentArtifact | undefined {
    const artifact = this.artifacts.get(id);
    if (
      artifact === undefined ||
      artifact.kind === "INSTALLED" ||
      artifact.packageName === undefined ||
      artifact.versionName === undefined ||
      artifact.versionCode === undefined ||
      artifact.signerSha256 === undefined
    )
      return undefined;
    const relative = win32.relative(this.artifactRoot, artifact.storedPath);
    if (relative === "" || relative.startsWith("..") || win32.isAbsolute(relative))
      return undefined;
    return {
      id: artifact.id,
      kind: artifact.kind,
      packageName: artifact.packageName,
      versionName: artifact.versionName,
      versionCode: artifact.versionCode,
      signerSha256: artifact.signerSha256,
      storedPath: artifact.storedPath,
    };
  }
}

function assertAdbSuccess(
  result: { readonly exitCode: number | null; readonly timedOut: boolean; readonly stderr: string },
  operation: string,
): void {
  if (result.timedOut || result.exitCode !== 0)
    throw new Error(`${operation} failed: ${result.stderr.trim()}`);
}

function parsePid(result: {
  readonly stdout: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stderr: string;
}): number | null {
  if (result.timedOut || result.exitCode !== 0) return null;
  const match = result.stdout.trim().match(/^\d+$/m);
  return match === null ? null : Number(match[0]);
}
