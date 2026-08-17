import { describe, expect, it } from "vitest";

import { createZipManifest, serializeZipManifest } from "./zip-manifest.js";

const sha = (digit: string): string => digit.repeat(64);

describe("ZIP evidence manifest", () => {
  it("normalizes and deterministically sorts the HTML and READY evidence entries", () => {
    const manifest = createZipManifest({
      html: {
        relativePath: "reports\\report.html",
        sha256: sha("a"),
        sizeBytes: 128,
      },
      evidence: [
        {
          id: "ev-z",
          kind: "LOGCAT_SEGMENT",
          state: "READY",
          finalRelativePath: "evidence\\Z.txt",
          sha256: sha("b"),
          sizeBytes: 20,
        },
        {
          id: "ev-a",
          kind: "SCREENSHOT",
          state: "READY",
          serial: "emulator-5554",
          finalRelativePath: "evidence/a.png",
          sha256: sha("c"),
          sizeBytes: 30,
        },
      ],
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      entries: [
        {
          path: "evidence/a.png",
          type: "EVIDENCE",
          associationId: "ev-a",
          kind: "SCREENSHOT",
          serial: "emulator-5554",
          sha256: sha("c"),
          sizeBytes: 30,
        },
        {
          path: "evidence/Z.txt",
          type: "EVIDENCE",
          associationId: "ev-z",
          kind: "LOGCAT_SEGMENT",
          sha256: sha("b"),
          sizeBytes: 20,
        },
        {
          path: "reports/report.html",
          type: "HTML_REPORT",
          associationId: "report-html",
          sha256: sha("a"),
          sizeBytes: 128,
        },
      ],
      unavailable: [],
    });
    expect(serializeZipManifest(manifest)).toBe(
      '{"entries":[{"associationId":"ev-a","kind":"SCREENSHOT","path":"evidence/a.png","serial":"emulator-5554","sha256":"' +
        sha("c") +
        '","sizeBytes":30,"type":"EVIDENCE"},{"associationId":"ev-z","kind":"LOGCAT_SEGMENT","path":"evidence/Z.txt","sha256":"' +
        sha("b") +
        '","sizeBytes":20,"type":"EVIDENCE"},{"associationId":"report-html","path":"reports/report.html","sha256":"' +
        sha("a") +
        '","sizeBytes":128,"type":"HTML_REPORT"}],"schemaVersion":1,"unavailable":[]}',
    );
  });

  it("records FAILED and MISSING evidence without claiming nonexistent archive entries", () => {
    const manifest = createZipManifest({
      html: {
        relativePath: "reports/report.html",
        sha256: sha("a"),
        sizeBytes: 1,
      },
      evidence: [
        {
          id: "ev-failed",
          kind: "VIDEO",
          state: "FAILED",
          errorCategory: "PUBLISH_FAILED",
        },
        {
          id: "ev-missing",
          kind: "SCREENSHOT",
          state: "MISSING",
          unavailableReason: "SOURCE_NOT_READY",
        },
      ],
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.unavailable).toEqual([
      {
        associationId: "ev-failed",
        kind: "VIDEO",
        state: "FAILED",
        errorCategory: "PUBLISH_FAILED",
      },
      {
        associationId: "ev-missing",
        kind: "SCREENSHOT",
        state: "MISSING",
        unavailableReason: "SOURCE_NOT_READY",
      },
    ]);
  });

  it.each([
    ["absolute path", "C:/outside/report.html"],
    ["traversal path", "evidence/../outside.txt"],
    ["empty path", ""],
  ])("rejects %s in the HTML source", (_label, relativePath) => {
    expect(() =>
      createZipManifest({
        html: { relativePath, sha256: sha("a"), sizeBytes: 1 },
        evidence: [],
      }),
    ).toThrow(/relative path/i);
  });

  it("rejects duplicate and case-insensitive-colliding entry paths", () => {
    expect(() =>
      createZipManifest({
        html: { relativePath: "reports/report.html", sha256: sha("a"), sizeBytes: 1 },
        evidence: [
          {
            id: "ev-1",
            kind: "SCREENSHOT",
            state: "READY",
            finalRelativePath: "reports/REPORT.HTML",
            sha256: sha("b"),
            sizeBytes: 2,
          },
        ],
      }),
    ).toThrow(/duplicate|collision/i);
  });

  it("rejects READY evidence missing measured metadata", () => {
    expect(() =>
      createZipManifest({
        html: { relativePath: "reports/report.html", sha256: sha("a"), sizeBytes: 1 },
        evidence: [
          {
            id: "ev-ready",
            kind: "SCREENSHOT",
            state: "READY",
            finalRelativePath: "evidence/shot.png",
            sha256: sha("b"),
          },
        ],
      }),
    ).toThrow(/sizeBytes/i);
  });
});
