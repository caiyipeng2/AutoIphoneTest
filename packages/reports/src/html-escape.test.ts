import { describe, expect, it } from "vitest";

import { escapeHtmlAttribute, escapeHtmlText, toSafeRelativeHref } from "./html-escape.js";

describe("offline report HTML safety primitives", () => {
  it("escapes hostile text and attribute values without changing safe Unicode", () => {
    const hostile = `<script>alert("x")</script> & '金币'`;

    expect(escapeHtmlText(hostile)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;金币&#39;",
    );
    expect(escapeHtmlAttribute(hostile)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;金币&#39;",
    );
  });

  it("accepts only local relative evidence links", () => {
    expect(toSafeRelativeHref("evidence/logcat-1.txt")).toBe("evidence/logcat-1.txt");
    expect(toSafeRelativeHref("reports/summary.html")).toBe("reports/summary.html");

    for (const value of [
      "",
      "/absolute/file.txt",
      "//external.example/file.txt",
      "https://external.example/file.txt",
      "data:text/html,<script>alert(1)</script>",
      "../outside.txt",
      "evidence/../outside.txt",
      "evidence\\logcat.txt",
      "evidence/logcat.txt?download=1",
      "evidence/logcat.txt#fragment",
      "evidence/%2e%2e/outside.txt",
    ]) {
      expect(() => toSafeRelativeHref(value)).toThrow(
        /relative|local|path|query|fragment|encoded/i,
      );
    }
  });

  it("rejects control characters before a value can enter an HTML attribute", () => {
    expect(() => toSafeRelativeHref("evidence/logcat\n.txt")).toThrow(/control/i);
  });
});
