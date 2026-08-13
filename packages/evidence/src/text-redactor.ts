import { createHash } from "node:crypto";

export interface MaskedText {
  readonly masked: true;
  readonly length: number;
  readonly categorySummary: string;
  readonly saltedSha256: string;
}

export interface TextRedactorOptions {
  readonly runSalt: string;
}

/** Keeps test text out of persistence and diagnostics while retaining reviewable shape metadata. */
export class TextRedactor {
  private readonly runSalt: string;

  public constructor(options: TextRedactorOptions) {
    if (options.runSalt.length < 16)
      throw new TypeError("runSalt must contain at least 16 characters.");
    this.runSalt = options.runSalt;
  }

  public mask(value: string): MaskedText {
    if (value.length === 0) throw new TypeError("Text to mask must not be empty.");
    const codePoints = Array.from(value);
    return {
      masked: true,
      length: codePoints.length,
      categorySummary: codePoints.map(categoryOf).join(""),
      saltedSha256: `sha256:${createHash("sha256").update(`${this.runSalt}\0${value}`, "utf8").digest("hex")}`,
    };
  }

  public redact(value: string, secrets: readonly string[]): string {
    let output = value;
    for (const secret of secrets) {
      if (secret.length === 0) continue;
      output = output.replaceAll(secret, "[REDACTED_TEXT]");
      output = output.replaceAll(JSON.stringify(secret), '"[REDACTED_TEXT]"');
    }
    return output;
  }
}

function categoryOf(value: string): string {
  if (/^\p{L}$/u.test(value)) return "L";
  if (/^\p{N}$/u.test(value)) return "N";
  if (/^\s$/u.test(value)) return "S";
  if (/^[\p{P}\p{S}]$/u.test(value)) return "P";
  return "O";
}
