import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { win32 } from "node:path";

import { credentialTarget } from "./credential-helper-client.js";

export type SigningProfileStorage = "memory" | "windows-credential-manager";

export interface SigningProfile {
  readonly id: string;
  readonly displayName: string;
  readonly keystorePath: string;
  readonly alias: string;
  readonly certificateSha256: string;
  readonly credentialTarget: string;
  readonly storage: SigningProfileStorage;
}

export type SigningProfileInput = Omit<SigningProfile, "storage"> & {
  readonly storage?: SigningProfileStorage;
};

export interface CredentialSecretStore {
  put(name: string, secret: string): Promise<void>;
  get(name: string): Promise<string>;
  delete(name: string): Promise<void>;
}

export interface SigningProfileStoreOptions {
  readonly credentialClient?: CredentialSecretStore;
}

export class SigningProfileStore {
  private readonly profiles = new Map<string, SigningProfile>();
  private readonly memorySecrets = new Map<string, string>();

  public constructor(private readonly options: SigningProfileStoreOptions = {}) {}

  public create(input: SigningProfileInput): SigningProfile {
    const profile = normalizeSigningProfile(input);
    if (this.profiles.has(profile.id))
      throw new Error(`Signing profile '${profile.id}' already exists.`);
    this.profiles.set(profile.id, profile);
    return profile;
  }

  public get(id: string): SigningProfile | undefined {
    return this.profiles.get(id);
  }

  public list(): SigningProfile[] {
    return [...this.profiles.values()];
  }

  public delete(id: string): boolean {
    this.memorySecrets.delete(id);
    return this.profiles.delete(id);
  }

  public async putSecret(id: string, secret: string): Promise<void> {
    const profile = this.require(id);
    if (profile.storage === "windows-credential-manager") {
      if (this.options.credentialClient === undefined) {
        throw new Error("Windows Credential Manager client is required for this profile.");
      }
      await this.options.credentialClient.put(profile.credentialTarget, secret);
      return;
    }
    this.memorySecrets.set(id, secret);
  }

  public async getSecret(id: string): Promise<string> {
    const profile = this.require(id);
    if (profile.storage === "windows-credential-manager") {
      if (this.options.credentialClient === undefined) {
        throw new Error("Windows Credential Manager client is required for this profile.");
      }
      return await this.options.credentialClient.get(profile.credentialTarget);
    }
    const secret = this.memorySecrets.get(id);
    if (secret === undefined) throw new Error(`Signing secret '${id}' is not available.`);
    return secret;
  }

  public async deleteSecret(id: string): Promise<void> {
    const profile = this.require(id);
    this.memorySecrets.delete(id);
    if (profile.storage === "windows-credential-manager") {
      if (this.options.credentialClient === undefined) {
        throw new Error("Windows Credential Manager client is required for this profile.");
      }
      await this.options.credentialClient.delete(profile.credentialTarget);
    }
  }

  private require(id: string): SigningProfile {
    const profile = this.get(id);
    if (profile === undefined) throw new Error(`Unknown signing profile '${id}'.`);
    return profile;
  }
}

export interface KeytoolProcess {
  readonly executablePath: string;
  readonly args: readonly string[];
}

export interface KeytoolResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type KeytoolRunner = (process: KeytoolProcess) => Promise<KeytoolResult>;

export async function validateSigningProfile(
  profile: SigningProfile,
  run: KeytoolRunner,
  keytoolPath = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\keytool.exe",
): Promise<void> {
  const result = await run({
    executablePath: keytoolPath,
    args: ["-list", "-v", "-keystore", profile.keystorePath, "-alias", profile.alias],
  });
  if (result.exitCode !== 0) {
    throw new Error(`keytool validation failed with exit code ${String(result.exitCode)}.`);
  }
  const actual = parseCertificateFingerprint(result.stdout);
  const expected = Buffer.from(profile.certificateSha256, "hex");
  if (
    actual === undefined ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("keytool certificate fingerprint does not match signing profile.");
  }
}

export interface SecretFiles {
  readonly storePasswordPath: string;
  readonly keyPasswordPath: string;
  readonly args: readonly [string, string];
  readonly cleanup: () => Promise<void>;
  readonly exists: () => boolean;
}

export interface SecretFilesOptions {
  readonly restrictDirectory?: (directory: string) => Promise<void>;
}

export async function createSecretFiles(
  tempRoot: string,
  operationId: string,
  secrets: { readonly storePassword: string; readonly keyPassword: string },
  options: SecretFilesOptions = {},
): Promise<SecretFiles> {
  if (!win32.isAbsolute(tempRoot))
    throw new TypeError("tempRoot must be an absolute Windows path.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(operationId)) {
    throw new TypeError("operationId must be a simple identifier.");
  }
  const operationRoot = win32.join(win32.normalize(tempRoot), "secrets", operationId);
  const storePasswordPath = win32.join(operationRoot, "store-password.txt");
  const keyPasswordPath = win32.join(operationRoot, "key-password.txt");
  await mkdir(operationRoot, { recursive: true });
  try {
    await (options.restrictDirectory ?? restrictWindowsDirectory)(operationRoot);
    await writeFile(storePasswordPath, secrets.storePassword, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(keyPasswordPath, secrets.keyPassword, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    await rm(operationRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    storePasswordPath,
    keyPasswordPath,
    args: [`file:${storePasswordPath}`, `file:${keyPasswordPath}`],
    cleanup: async () => await rm(operationRoot, { recursive: true, force: true }),
    exists: () => existsSync(operationRoot),
  };
}

function parseCertificateFingerprint(output: string): Buffer | undefined {
  const match = output.match(/SHA-?256\s*:\s*([0-9a-f: ]+)/i);
  if (match?.[1] === undefined) return undefined;
  const hex = match[1].replaceAll(/[^0-9a-f]/gi, "");
  if (hex.length !== 64) return undefined;
  return Buffer.from(hex, "hex");
}

async function restrictWindowsDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const icaclsPath = win32.join(systemRoot, "System32", "icacls.exe");
  const account = `${process.env.USERDOMAIN ?? "."}\\${process.env.USERNAME ?? "unknown"}`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      icaclsPath,
      [directory, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"],
      { windowsHide: true, shell: false, stdio: "ignore" },
    );
    child.once("error", () =>
      reject(new Error("Unable to start ACL hardening for secret directory.")),
    );
    child.once("close", (exitCode) =>
      exitCode === 0
        ? resolve()
        : reject(new Error("ACL hardening rejected the secret directory.")),
    );
  });
}

function normalizeSigningProfile(input: SigningProfileInput): SigningProfile {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.id)) {
    throw new TypeError("Signing profile id is invalid.");
  }
  if (!input.displayName.trim()) throw new TypeError("Signing profile displayName is required.");
  if (!win32.isAbsolute(input.keystorePath)) throw new TypeError("keystorePath must be absolute.");
  if (!input.alias.trim()) throw new TypeError("Signing profile alias is required.");
  if (!/^[a-f0-9]{64}$/.test(input.certificateSha256)) {
    throw new TypeError("certificateSha256 must be lowercase SHA-256 hex.");
  }
  const expectedTarget = credentialTarget(input.id);
  if (input.credentialTarget !== expectedTarget) {
    throw new TypeError("credentialTarget must match the signing profile namespace.");
  }
  return {
    id: input.id,
    displayName: input.displayName.trim(),
    keystorePath: win32.normalize(input.keystorePath),
    alias: input.alias.trim(),
    certificateSha256: input.certificateSha256,
    credentialTarget: expectedTarget,
    storage: input.storage ?? "memory",
  };
}
