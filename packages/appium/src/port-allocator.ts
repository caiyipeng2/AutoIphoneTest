import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";

export interface PortRange {
  readonly start: number;
  readonly end: number;
}

export interface PortRanges {
  readonly appium: PortRange;
  readonly system: PortRange;
  readonly mjpeg: PortRange;
}

export interface PortLease {
  readonly leaseId: string;
  readonly serial: string;
  readonly appiumPort: number;
  readonly systemPort: number;
  readonly mjpegPort: number;
  readonly ownerPid: number;
  readonly ownerToken: string;
  readonly createdAt: number;
}

export interface PortLeaseStore {
  list(): Promise<readonly PortLease[]>;
  save(lease: PortLease): Promise<void>;
  remove(leaseId: string): Promise<void>;
}

export class JsonFilePortLeaseStore implements PortLeaseStore {
  public constructor(private readonly filePath: string) {}

  public async list(): Promise<readonly PortLease[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("lease store root must be an array.");
      return parsed.map(parseLease);
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
  }

  public async save(lease: PortLease): Promise<void> {
    const leases = [
      ...(await this.list()).filter((candidate) => candidate.leaseId !== lease.leaseId),
      lease,
    ];
    await this.write(leases);
  }

  public async remove(leaseId: string): Promise<void> {
    const leases = (await this.list()).filter((candidate) => candidate.leaseId !== leaseId);
    await this.write(leases);
  }

  private async write(leases: readonly PortLease[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const partialPath = `${this.filePath}.partial`;
    await writeFile(partialPath, `${JSON.stringify(leases, null, 2)}\n`, "utf8");
    await rename(partialPath, this.filePath);
  }
}

export interface LeaseOwner {
  readonly ownerPid: number;
  readonly ownerToken: string;
}

export interface PortAllocatorOptions {
  readonly store: PortLeaseStore;
  readonly ranges: PortRanges;
  readonly isPortAvailable?: (port: number) => Promise<boolean>;
  readonly isOwnerAlive?: (pid: number) => Promise<boolean>;
  readonly now?: () => number;
}

export class PortAllocator {
  private readonly store: PortLeaseStore;
  private readonly ranges: PortRanges;
  private readonly isPortAvailable: (port: number) => Promise<boolean>;
  private readonly isOwnerAlive: (pid: number) => Promise<boolean>;
  private readonly now: () => number;

  public constructor(options: PortAllocatorOptions) {
    validateRanges(options.ranges);
    this.store = options.store;
    this.ranges = options.ranges;
    this.isPortAvailable = options.isPortAvailable ?? isLoopbackPortAvailable;
    this.isOwnerAlive = options.isOwnerAlive ?? isProcessAlive;
    this.now = options.now ?? Date.now;
  }

  public async allocate(serial: string, owner: LeaseOwner): Promise<PortLease> {
    if (!serial.trim()) throw new TypeError("serial must not be empty.");
    validateOwner(owner);

    const leases = await this.store.list();
    for (const lease of leases) {
      if (lease.ownerPid === owner.ownerPid && lease.ownerToken === owner.ownerToken) continue;
      if (!(await this.isOwnerAlive(lease.ownerPid))) await this.store.remove(lease.leaseId);
    }

    const active = (await this.store.list()).filter(
      (lease) => lease.ownerPid !== owner.ownerPid || lease.ownerToken !== owner.ownerToken,
    );
    const existing = active.find((lease) => lease.serial === serial);
    if (existing !== undefined)
      throw new Error(`serial '${serial}' already has an active port lease.`);

    const leaseId = createLeaseId(serial, owner.ownerToken);
    const current = (await this.store.list()).find((lease) => lease.leaseId === leaseId);
    if (current !== undefined) return current;

    const used = new Set<number>(
      active.flatMap((lease) => [lease.appiumPort, lease.systemPort, lease.mjpegPort]),
    );
    const appiumPort = await this.takePort(this.ranges.appium, used);
    used.add(appiumPort);
    const systemPort = await this.takePort(this.ranges.system, used);
    used.add(systemPort);
    const mjpegPort = await this.takePort(this.ranges.mjpeg, used);
    const lease: PortLease = {
      leaseId,
      serial,
      appiumPort,
      systemPort,
      mjpegPort,
      ...owner,
      createdAt: this.now(),
    };
    await this.store.save(lease);
    return lease;
  }

  public async release(leaseId: string, owner: LeaseOwner): Promise<void> {
    validateOwner(owner);
    const lease = (await this.store.list()).find((candidate) => candidate.leaseId === leaseId);
    if (lease === undefined) return;
    if (lease.ownerPid !== owner.ownerPid || lease.ownerToken !== owner.ownerToken) {
      throw new Error("lease owner mismatch.");
    }
    await this.store.remove(leaseId);
  }

  private async takePort(range: PortRange, used: ReadonlySet<number>): Promise<number> {
    for (let port = range.start; port <= range.end; port += 1) {
      if (!used.has(port) && (await this.isPortAvailable(port))) return port;
    }
    throw new Error(`no available port in range ${String(range.start)}-${String(range.end)}.`);
  }
}

function createLeaseId(serial: string, ownerToken: string): string {
  return createHash("sha256").update(`${serial}\0${ownerToken}`).digest("hex").slice(0, 24);
}

function parseLease(value: unknown): PortLease {
  if (typeof value !== "object" || value === null) throw new Error("invalid port lease record.");
  const record = value as Record<string, unknown>;
  const stringFields = ["leaseId", "serial", "ownerToken"] as const;
  for (const field of stringFields) {
    if (typeof record[field] !== "string" || record[field].length === 0)
      throw new Error(`invalid lease field '${field}'.`);
  }
  const numericFields = ["appiumPort", "systemPort", "mjpegPort", "ownerPid", "createdAt"] as const;
  for (const field of numericFields) {
    if (typeof record[field] !== "number" || !Number.isSafeInteger(record[field]))
      throw new Error(`invalid lease field '${field}'.`);
  }
  return {
    leaseId: record.leaseId as string,
    serial: record.serial as string,
    appiumPort: record.appiumPort as number,
    systemPort: record.systemPort as number,
    mjpegPort: record.mjpegPort as number,
    ownerPid: record.ownerPid as number,
    ownerToken: record.ownerToken as string,
    createdAt: record.createdAt as number,
  };
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validateRanges(ranges: PortRanges): void {
  for (const [name, range] of Object.entries(ranges)) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 1 ||
      range.end < range.start ||
      range.end > 65535
    ) {
      throw new TypeError(`${name} port range is invalid.`);
    }
  }
}

function validateOwner(owner: LeaseOwner): void {
  if (!Number.isInteger(owner.ownerPid) || owner.ownerPid <= 0 || !owner.ownerToken.trim())
    throw new TypeError("owner pid/token is invalid.");
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}
