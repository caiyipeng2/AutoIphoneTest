import { win32 } from "node:path";

export interface CredentialProcess {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface CredentialProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type CredentialProcessRunner = (
  process: CredentialProcess,
  stdin?: string,
) => Promise<CredentialProcessResult>;

export interface CredentialHelperClientOptions {
  readonly executablePath: string;
  readonly cwd?: string;
  readonly run?: CredentialProcessRunner;
}

export class CredentialHelperClient {
  private readonly executablePath: string;
  private readonly cwd: string;
  private readonly run: CredentialProcessRunner;

  public constructor(options: CredentialHelperClientOptions) {
    if (!win32.isAbsolute(options.executablePath)) {
      throw new TypeError("Credential helper executablePath must be absolute.");
    }
    this.executablePath = win32.normalize(options.executablePath);
    this.cwd = win32.normalize(options.cwd ?? win32.dirname(this.executablePath));
    this.run = options.run ?? defaultCredentialProcessRunner;
  }

  public async put(name: string, secret: string): Promise<void> {
    if (!secret) throw new TypeError("Credential secret is required.");
    await this.execute("put", name, secret);
  }

  public async get(name: string): Promise<string> {
    const result = await this.execute("get", name);
    return result.stdout;
  }

  public async delete(name: string): Promise<void> {
    await this.execute("delete", name);
  }

  private async execute(
    command: "put" | "get" | "delete",
    name: string,
    stdin?: string,
  ): Promise<CredentialProcessResult> {
    const process: CredentialProcess = {
      executablePath: this.executablePath,
      args: [command, credentialTarget(name)],
      cwd: this.cwd,
    };
    const result = await this.run(process, stdin);
    if (result.exitCode !== 0) {
      throw new Error(
        `Credential helper '${command}' failed with exit code ${String(result.exitCode)}.`,
      );
    }
    return result;
  }
}

export function credentialTarget(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new TypeError("Credential target name must be a simple signing profile identifier.");
  }
  return `UnityMultiDeviceTestCenter/Signing/${name}`;
}

async function defaultCredentialProcessRunner(
  process: CredentialProcess,
  stdin?: string,
): Promise<CredentialProcessResult> {
  const { spawn } = await import("node:child_process");
  return await new Promise<CredentialProcessResult>((resolve, reject) => {
    const child = spawn(process.executablePath, process.args, {
      cwd: process.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) =>
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    if (stdin !== undefined) child.stdin.end(stdin, "utf8");
    else child.stdin.end();
  });
}
