import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createImmutableReportModel, type ReportModelInput } from "./report-model.js";
import {
  PdfReportExporter,
  type PdfBrowser,
  type PdfBrowserFactory,
  type PdfPage,
  type PdfPdfOptions,
} from "./pdf-exporter.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (path) => {
      try {
        await rm(path, { force: true });
      } catch {
        // Best effort cleanup keeps a failed assertion from hiding its evidence.
      }
    }),
  );
});

describe("PdfReportExporter", () => {
  it("renders an A4 landscape offline PDF with print continuation rules", async () => {
    const page = new FakePage(pdfWithPages(2));
    const browser = new FakeBrowser(page);
    const factory: PdfBrowserFactory = { launch: vi.fn(async () => browser) };

    const result = await new PdfReportExporter({ browserFactory: factory }).render(
      createImmutableReportModel(createFixtureInput()),
    );

    expect(page.html).toContain('id="pdf-print-style"');
    expect(page.html).toContain("@page { size: A4 landscape;");
    expect(page.html).toContain("thead { display: table-header-group;");
    expect(page.fontsReady).toBe(true);
    expect(page.pdfOptions).toMatchObject({
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
    });
    expect(page.pdfOptions?.headerTemplate).toContain("Idle Weapon Shop Tycoon");
    expect(page.pdfOptions?.footerTemplate).toContain("page");
    expect(result.content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(result.pageCount).toBe(2);
    expect(result.sizeBytes).toBe(result.content.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(page.closed).toBe(true);
    expect(browser.closed).toBe(true);
  });

  it("rejects an oversized PDF and always closes the browser resources", async () => {
    const page = new FakePage(pdfWithPages(3));
    const browser = new FakeBrowser(page);
    const factory: PdfBrowserFactory = { launch: vi.fn(async () => browser) };

    await expect(
      new PdfReportExporter({ browserFactory: factory, maxPages: 2 }).render(
        createImmutableReportModel(createFixtureInput()),
      ),
    ).rejects.toThrow("maximum page count");
    expect(page.closed).toBe(true);
    expect(browser.closed).toBe(true);
  });

  it("publishes the PDF atomically with a hash and no partial file", async () => {
    const page = new FakePage(pdfWithPages(1));
    const browser = new FakeBrowser(page);
    const factory: PdfBrowserFactory = { launch: vi.fn(async () => browser) };
    const finalPath = join(tmpdir(), `test-center-pdf-${Date.now()}.pdf`);
    temporaryPaths.push(finalPath, `${finalPath}.partial`);

    const result = await new PdfReportExporter({ browserFactory: factory }).publish(
      createImmutableReportModel(createFixtureInput()),
      finalPath,
    );
    const bytes = await readFile(finalPath);

    expect(result.finalPath).toBe(finalPath);
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.pageCount).toBe(1);
    await expect(readFile(`${finalPath}.partial`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

class FakePage implements PdfPage {
  public html = "";
  public pdfOptions: PdfPdfOptions | undefined;
  public fontsReady = false;
  public closed = false;

  public constructor(private readonly bytes: Buffer) {}

  public async setContent(html: string, _options: { waitUntil: "load" }): Promise<void> {
    void _options;
    this.html = html;
  }

  public async waitForFonts(): Promise<void> {
    this.fontsReady = true;
  }

  public async pdf(options: PdfPdfOptions): Promise<Uint8Array> {
    this.pdfOptions = options;
    return this.bytes;
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowser implements PdfBrowser {
  public closed = false;

  public constructor(private readonly page: FakePage) {}

  public async newPage(): Promise<PdfPage> {
    return this.page;
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

function pdfWithPages(count: number): Buffer {
  return Buffer.from(
    `%PDF-1.7\n${Array.from({ length: count }, (_, index) => `${index + 1} 0 obj <</Type /Page>>`).join("\n")}\n%%EOF`,
    "latin1",
  );
}

function createFixtureInput(): ReportModelInput {
  return {
    schemaVersion: 1,
    run: {
      id: "run-pdf",
      packageName: "Idle Weapon Shop Tycoon",
      state: "FINISHED",
      currentEpoch: 3,
      createdAt: "2026-08-20T01:00:00.000Z",
      updatedAt: "2026-08-20T01:05:00.000Z",
    },
    devices: [
      {
        serial: "ABC1234567",
        uid: "UID-PDF",
        role: "LEADER",
        membershipState: "ACTIVE",
        generation: 3,
      },
    ],
    actions: [
      {
        id: "action-1",
        actionSeq: 1,
        type: "tap",
        state: "SUCCEEDED",
        label: "Open shop",
        targets: [{ serial: "ABC1234567", state: "SUCCEEDED" }],
      },
    ],
    evidence: [],
    incidents: [],
    recoveries: [],
  };
}
