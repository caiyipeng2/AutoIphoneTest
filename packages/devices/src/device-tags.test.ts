import { describe, expect, it } from "vitest";

import { normalizeDeviceTags } from "./device-tags.js";

describe("device tags", () => {
  it("normalizes case for uniqueness while preserving the first display label", () => {
    expect(normalizeDeviceTags([" Smoke ", "smoke", "Regression"], " Nightly ")).toEqual({
      tags: [
        { key: "smoke", label: "Smoke" },
        { key: "regression", label: "Regression" },
      ],
      group: { key: "nightly", label: "Nightly" },
    });
  });

  it("rejects empty, oversized, duplicate and over-counted labels", () => {
    expect(() => normalizeDeviceTags([" "])).toThrow();
    expect(() => normalizeDeviceTags(["a".repeat(41)])).toThrow();
    expect(() =>
      normalizeDeviceTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`)),
    ).toThrow();
  });
});
