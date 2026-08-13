import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TextRedactor } from "./text-redactor.js";

describe("TextRedactor", () => {
  it("masks text while retaining Unicode shape and a run-salted digest", () => {
    const redactor = new TextRedactor({ runSalt: "run-salt-0123456789" });
    const result = redactor.mask("金币 ABC 123🙂");
    expect(result).toMatchObject({ masked: true, length: 11, categorySummary: "LLSLLLSNNNP" });
    expect(result).not.toHaveProperty("text");
    expect(result.saltedSha256).toBe(
      `sha256:${createHash("sha256").update("run-salt-0123456789\0金币 ABC 123🙂", "utf8").digest("hex")}`,
    );
  });

  it("redacts exact and JSON-escaped secret text from diagnostics", () => {
    const redactor = new TextRedactor({ runSalt: "run-salt-0123456789" });
    expect(redactor.redact('typed="金币 ABC" raw=金币 ABC', ["金币 ABC"])).toBe(
      'typed="[REDACTED_TEXT]" raw=[REDACTED_TEXT]',
    );
  });

  it("rejects an empty input or an unsafe short salt", () => {
    expect(() => new TextRedactor({ runSalt: "short" })).toThrow(/runSalt/);
    expect(() => new TextRedactor({ runSalt: "run-salt-0123456789" }).mask("")).toThrow(/empty/);
  });
});
