import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceManifestStore } from "../../packages/evidence/src/evidence-manifest.js";
import { redactLogcatEvidence } from "../../packages/evidence/src/logcat-evidence.js";
import { EvidenceZipPublisher } from "../../packages/reports/src/evidence-zip.js";
import { EvidenceZipVerifier } from "../../packages/reports/src/evidence-zip-verifier.js";
import { escapeHtmlText, toSafeRelativeHref } from "../../packages/reports/src/html-escape.js";
import { renderOfflineReport } from "../../packages/reports/src/html-renderer.js";
import { createImmutableReportModel } from "../../packages/reports/src/report-model.js";
import {
  createZipManifest,
  serializeZipManifest,
} from "../../packages/reports/src/zip-manifest.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

describe("M10 report output security matrix", () => {
  it("keeps hostile, formula-like, and Unicode values inert in offline HTML", () => {
    const html = renderOfflineReport(
      createImmutableReportModel({
        schemaVersion: 1,
        run: {
          id: "run-security-html",
          packageName: '<svg onload="alert(1)">金币店',
          state: "FAILED",
          currentEpoch: 1,
          createdAt: "2026-08-20T01:00:00.000Z",
          updatedAt: "2026-08-20T01:01:00.000Z",
        },
        devices: [
          {
            serial: "ABC1234567",
            uid: "UID-汉字🙂",
            role: "LEADER",
            membershipState: "ACTIVE",
            generation: 1,
          },
        ],
        actions: [
          {
            id: "action-security",
            actionSeq: 1,
            type: "tap",
            state: "FAILED",
            label: '=SUM(A1:A2) <img src=x onerror="alert(1)">',
            targets: [{ serial: "ABC1234567", state: "FAILED" }],
          },
        ],
        evidence: [
          {
            id: "evidence-unicode",
            kind: "CURRENT_SCREENSHOT",
            state: "READY",
            finalRelativePath: "evidence/截图-金币.txt",
            sha256: digest("safe"),
            sizeBytes: 4,
          },
        ],
        incidents: [],
        recoveries: [],
      }),
    );

    expect(html).toContain("=SUM(A1:A2)");
    expect(html).toContain('href="evidence/截图-金币.txt"');
    expect(html).toContain("&lt;svg onload=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/(?:https?:|data:|javascript:)/i);
    expect(html).not.toContain("<link");
    expect(html).toContain("default-src 'none'");
    expect(escapeHtmlText("=SUM(A1:A2)")).toBe("=SUM(A1:A2)");
    expect(() => toSafeRelativeHref("https://external.example/report.txt")).toThrow(
      /relative|local/i,
    );
  });

  it("redacts token, secret, JSON, and formula-like action text before publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-report-security-logcat-"));
    roots.push(root);
    const source = [
      "08-20 10:11:12.345  123  456 I Unity: token=top-secret csrf=csrf-secret action==SUM(A1:A2)\n",
      '08-20 10:11:13.345  123  456 W Unity: {"access_token":"json-secret"} keystore_password=key-secret\n',
    ].join("");
    await writeFile(join(root, "logcat.raw"), source, "utf8");
    const store = new EvidenceManifestStore({ rootPath: root, runId: "run-security-logcat" });
    await store.register({
      evidenceId: "logcat-security",
      kind: "logcat-segment",
      relativePath: "logcat.raw",
      serial: "ABC1234567",
      metadata: { startedAtMonotonicMs: 1, endedAtMonotonicMs: 2 },
    });
    const manifest = await store.flush();

    const result = await redactLogcatEvidence({
      rootPath: root,
      manifest,
      evidenceId: "logcat-security",
      serial: "ABC1234567",
      secrets: ["top-secret", "csrf-secret", "json-secret", "key-secret"],
      actionTexts: ["=SUM(A1:A2)"],
      maxBytes: 4096,
      maxLines: 10,
    });

    expect(result.content).toContain("[REDACTED_TEXT]");
    for (const secret of [
      "top-secret",
      "csrf-secret",
      "json-secret",
      "key-secret",
      "=SUM(A1:A2)",
    ]) {
      expect(result.content).not.toContain(secret);
    }
  });

  it("publishes forced ZIP64, preserves 64-bit-safe sizes, and verifies Unicode entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-report-security-zip-"));
    roots.push(root);
    const html = "<html>安全报告</html>\n";
    const manifest = createZipManifest({
      html: {
        relativePath: "reports/报告.html",
        sha256: digest(html),
        sizeBytes: Buffer.byteLength(html),
      },
      evidence: [
        {
          id: "evidence-missing",
          kind: "VIDEO",
          state: "MISSING",
          unavailableReason: "DEVICE_DISCONNECTED",
        },
      ],
    });
    const simulatedLargeSize = 4 * 1024 * 1024 * 1024 + 7;
    const largeManifest = createZipManifest({
      html: {
        relativePath: "reports/large.html",
        sha256: digest(""),
        sizeBytes: simulatedLargeSize,
      },
      evidence: [],
    });
    expect(serializeZipManifest(largeManifest)).toContain(`"sizeBytes":${simulatedLargeSize}`);

    await new EvidenceZipPublisher({ runRoot: root }).publish({
      relativePath: "reports/evidence.zip",
      attempt: 1,
      manifest,
      entries: [
        {
          path: "reports/报告.html",
          associationId: "report-html",
          source: Readable.from([html]),
        },
      ],
    });
    const archive = await readFile(join(root, "reports", "evidence.zip"));
    expect(archive.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    await expect(
      new EvidenceZipVerifier({ runRoot: root }).verify({
        relativePath: "reports/evidence.zip",
        manifest,
      }),
    ).resolves.toMatchObject({ state: "VERIFIED", entries: [{ path: "reports/报告.html" }] });
  });
});
