import { describe, expect, it } from "vitest";

import { safeSpreadsheetText } from "./spreadsheet-value.js";

describe("safe spreadsheet values", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@user", "\tleading", "\nleading", "\rleading"])(
    "prefixes formula or control-leading text: %j",
    (input) => {
      const result = safeSpreadsheetText(input);

      expect(result.value).toBe(`'${input}`);
      expect(result.sanitized).toBe(true);
    },
  );

  it("preserves ordinary Unicode text without creating a formula", () => {
    expect(safeSpreadsheetText("升级武器 / 日本語 / 中文")).toEqual({
      value: "升级武器 / 日本語 / 中文",
      sanitized: false,
    });
  });

  it("replaces embedded non-printing controls while retaining a safe text value", () => {
    expect(safeSpreadsheetText("token\u0000\u0007value")).toEqual({
      value: "token  value",
      sanitized: true,
    });
  });
});
