import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PortAllocator, PortRange } from "@test-center/appium";

export interface WorkerResourceIdentity {
  readonly runId: string;
  readonly serial: string;
  readonly generation: number;
}

export interface WorkerResourcePorts {
  readonly appium: number;
  readonly system: number;
  readonly mjpeg: number;
  readonly bridge: number;
}

export interface WorkerResourcePaths {
  readonly logs: string;
  readonly preview: string;
  readonly evidence: string;
}

export interface WorkerResourceLease {
  readonly leaseId: string;
  readonly identity: WorkerResourceIdentity;
  readonly ownerToken: string;
  readonly ports: WorkerResourcePorts;
  readonly paths: WorkerResourcePaths;
  readonly appiumLeaseId: string;
}

export interface WorkerResourceManagerOptions {
  readonly allocator: Pick<PortAllocator, "allocate" | "release">;
  readonly bridgeRange: PortRange;
  readonly rootPath: string;
  readonly ownerPid: number;
  readonly isPortAvailable?: (port: number) => Promise<boolean>;
  readonly manifestPath?: string;
}

export class WorkerResourceManager {
  private readonly manifestPath: string;
  private readonly isPortAvailable: (port: number) => Promise<boolean>;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: WorkerResourceManagerOptions) {
    validateRange(options.bridgeRange);
    if (!Number.isInteger(options.ownerPid) || options.ownerPid <= 0)
      throw new TypeError("ownerPid must be a positive integer.");
    this.manifestPath = options.manifestPath ?? join(options.rootPath, "worker-resources.json");
    this.isPortAvailable = options.isPortAvailable ?? defaultPortAvailable;
  }

  public async list(): Promise<readonly WorkerResourceLease[]> {
    try {
      const raw = await readFile(this.manifestPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("worker resource manifest must be an array.");
      return parsed as WorkerResourceLease[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  public async allocate(identity: WorkerResourceIdentity): Promise<WorkerResourceLease> {
    return this.withMutation(async () => {
      validateIdentity(identity);
      const current = (await this.list()).find(
        (lease) =>
          lease.identity.runId === identity.runId && lease.identity.serial === identity.serial,
      );
      if (current !== undefined) {
        if (current.identity.generation === identity.generation) return current;
        throw new Error(`worker serial '${identity.serial}' already has an active resource lease.`);
      }

      const ownerToken = createOwnerToken(identity);
      const appiumLease = await this.options.allocator.allocate(identity.serial, {
        ownerPid: this.options.ownerPid,
        ownerToken,
      });
      const createdDirectories: string[] = [];
      try {
        const activeWorkerLeases = await this.list();
        const bridgeUsed = new Set<number>(
          activeWorkerLeases.flatMap((lease) => Object.values(lease.ports)),
        );
        const bridge = await takePort(
          this.options.bridgeRange,
          new Set([
            ...bridgeUsed,
            appiumLease.appiumPort,
            appiumLease.systemPort,
            appiumLease.mjpegPort,
          ]),
          this.isPortAvailable,
        );
        const generationRoot = join(
          this.options.rootPath,
          "workers",
          sanitize(identity.runId),
          sanitize(identity.serial),
          `generation-${String(identity.generation)}`,
        );
        const paths = {
          logs: join(generationRoot, "logs"),
          preview: join(generationRoot, "preview"),
          evidence: join(generationRoot, "evidence"),
        };
        for (const path of Object.values(paths)) {
          await mkdir(path, { recursive: true });
          createdDirectories.push(path);
        }
        const lease: WorkerResourceLease = {
          leaseId: createLeaseId(identity),
          identity,
          ownerToken,
          ports: {
            appium: appiumLease.appiumPort,
            system: appiumLease.systemPort,
            mjpeg: appiumLease.mjpegPort,
            bridge,
          },
          paths,
          appiumLeaseId: appiumLease.leaseId,
        };
        await this.writeManifest([...(await this.list()), lease]);
        return lease;
      } catch (error) {
        for (const path of createdDirectories) await rm(path, { recursive: true, force: true });
        await this.options.allocator.release(appiumLease.leaseId, {
          ownerPid: this.options.ownerPid,
          ownerToken,
        });
        throw error;
      }
    });
  }

  public async release(lease: WorkerResourceLease, ownerToken: string): Promise<void> {
    return this.withMutation(async () => {
      if (ownerToken !== lease.ownerToken) throw new Error("worker resource owner mismatch.");
      const leases = await this.list();
      const current = leases.find((candidate) => candidate.leaseId === lease.leaseId);
      if (current === undefined) return;
      if (current.ownerToken !== ownerToken) throw new Error("worker resource owner mismatch.");
      await this.options.allocator.release(current.appiumLeaseId, {
        ownerPid: this.options.ownerPid,
        ownerToken,
      });
      await rm(
        join(
          this.options.rootPath,
          "workers",
          sanitize(current.identity.runId),
          sanitize(current.identity.serial),
        ),
        {
          recursive: true,
          force: true,
        },
      );
      await this.writeManifest(leases.filter((candidate) => candidate.leaseId !== lease.leaseId));
    });
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let unlock!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }

  private async writeManifest(leases: readonly WorkerResourceLease[]): Promise<void> {
    await mkdir(this.options.rootPath, { recursive: true });
    await writeFile(this.manifestPath, `${JSON.stringify(leases, null, 2)}\n`, "utf8");
  }
}

function createOwnerToken(identity: WorkerResourceIdentity): string {
  return createHash("sha256")
    .update(`${identity.runId}\0${identity.serial}\0${String(identity.generation)}`)
    .digest("hex");
}

function createLeaseId(identity: WorkerResourceIdentity): string {
  return createOwnerToken(identity).slice(0, 24);
}

function validateIdentity(identity: WorkerResourceIdentity): void {
  if (
    !identity.runId.trim() ||
    !identity.serial.trim() ||
    !Number.isInteger(identity.generation) ||
    identity.generation <= 0
  )
    throw new TypeError("worker identity is invalid.");
}

function validateRange(range: PortRange): void {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 1 ||
    range.end < range.start ||
    range.end > 65535
  )
    throw new TypeError("bridge port range is invalid.");
}

async function takePort(
  range: PortRange,
  used: ReadonlySet<number>,
  available: (port: number) => Promise<boolean>,
): Promise<number> {
  for (let port = range.start; port <= range.end; port += 1) {
    if (!used.has(port) && (await available(port))) return port;
  }
  throw new Error(`no available bridge port in range ${String(range.start)}-${String(range.end)}.`);
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96) || "unknown";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function defaultPortAvailable(): Promise<boolean> {
  return true;
}
