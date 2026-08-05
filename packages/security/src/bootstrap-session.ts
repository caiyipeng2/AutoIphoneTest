import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

interface BootstrapRecord {
  readonly bootstrapHash: Buffer;
  readonly launchSecretHash: Buffer;
  readonly expiresAt: number;
  consumed: boolean;
}

export interface BootstrapSessionStoreOptions {
  readonly now?: () => number;
}

export interface BootstrapIssue {
  readonly bootstrapCode: string;
  readonly launchSecret: string;
  readonly expiresAt: number;
}

export interface SessionGrant {
  readonly sessionId: string;
  readonly csrfToken: string;
}

export class BootstrapSessionStore {
  private readonly records: BootstrapRecord[] = [];
  private readonly now: () => number;

  public constructor(options: BootstrapSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  public issue(issue: BootstrapIssue): void {
    if (!Number.isFinite(issue.expiresAt) || issue.expiresAt <= this.now()) {
      throw new TypeError("Bootstrap expiry must be in the future.");
    }
    if (!issue.bootstrapCode || !issue.launchSecret) {
      throw new TypeError("Bootstrap code and launch secret are required.");
    }
    this.records.push({
      bootstrapHash: digest(issue.bootstrapCode),
      launchSecretHash: digest(issue.launchSecret),
      expiresAt: issue.expiresAt,
      consumed: false,
    });
  }

  public consume(bootstrapCode: string): SessionGrant | undefined {
    const candidate = digest(bootstrapCode);
    for (const record of this.records) {
      if (record.consumed || record.expiresAt <= this.now()) {
        continue;
      }
      if (!timingSafeEqual(record.bootstrapHash, candidate)) {
        continue;
      }
      record.consumed = true;
      return {
        sessionId: randomUUID(),
        csrfToken: randomBytes(32).toString("base64url"),
      };
    }
    return undefined;
  }

  public debugRecords(): readonly {
    bootstrapHash: string;
    launchSecretHash: string;
    expiresAt: number;
    consumed: boolean;
  }[] {
    return this.records.map((record) => ({
      bootstrapHash: record.bootstrapHash.toString("hex"),
      launchSecretHash: record.launchSecretHash.toString("hex"),
      expiresAt: record.expiresAt,
      consumed: record.consumed,
    }));
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
