import { AdbClient } from "@test-center/adb";
import {
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
import type { DeviceSerial } from "@test-center/contracts/device";
import type Database from "better-sqlite3";
import {
  ARTIFACTS_MIGRATION,
  configureDatabase,
  DEVICES_MIGRATION,
  ensureRuntimeDirectories,
  FOUNDATION_MIGRATION,
  migrate,
  openDatabase,
  createRuntimePaths,
} from "@test-center/database";
import { createAdbDiscoverySource, DeviceRegistry, DeviceRepository } from "@test-center/devices";
import type { ArtifactRouteService, InstalledRegistrationResult } from "./routes/artifacts.js";

export interface RuntimeDeviceRegistry {
  readonly registry: DeviceRegistry;
  readonly artifactService: ArtifactRouteService;
  readonly close: () => void;
}

export async function createRuntimeDeviceRegistry(
  projectRoot: string,
): Promise<RuntimeDeviceRegistry> {
  const paths = createRuntimePaths(projectRoot, process.env.TEST_CENTER_DATA_ROOT);
  await ensureRuntimeDirectories(paths);
  const database = openDatabase(paths);
  configureDatabase(database);
  migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION, ARTIFACTS_MIGRATION]);
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
  return {
    registry: new DeviceRegistry(new DeviceRepository(database), createAdbDiscoverySource(client)),
    artifactService,
    close: () => database.close(),
  };
}

class RuntimeArtifactRouteService implements ArtifactRouteService {
  public readonly provider: ArtifactImportProvider;
  private readonly repository: ArtifactRepository;
  private readonly installedExecutor;

  public constructor(
    database: Database.Database,
    private readonly store: ContentStore,
    client: AdbClient,
    projectRoot: string,
    tempRoot: string,
  ) {
    this.repository = new ArtifactRepository(database, store);
    this.installedExecutor = createAdbInstalledIdentityExecutor(client, {
      signerSha256: createApksignerSignerResolver(client, {
        apksignerPath:
          process.env.TEST_CENTER_APKSIGNER_PATH ??
          "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\apksigner.bat",
        javaPath:
          process.env.TEST_CENTER_JAVA_PATH ??
          "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe",
        apksignerJarPath:
          process.env.TEST_CENTER_APKSIGNER_JAR_PATH ??
          "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\lib\\apksigner.jar",
        cwd: projectRoot,
        tempRoot,
      }),
    });
    const importService: ArtifactImportService = {
      stage: async (request) => await this.stageFile(request),
      parse: async () => ({}),
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

  private async stageFile(request: ArtifactImportFileRequest): Promise<StagedContent> {
    const { createReadStream } = await import("node:fs");
    return await this.store.stage(createReadStream(request.artifactPath), request.originalName);
  }

  private async removeStaged(staged: StagedContent): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(staged.partialPath, { force: true });
  }
}
