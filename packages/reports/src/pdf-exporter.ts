import { createHash } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { escapeHtmlText } from "./html-escape.js";
import { renderOfflineReport } from "./html-renderer.js";
import type { ImmutableReportModel } from "./report-model.js";

export interface PdfSetContentOptions {
  readonly waitUntil: "load";
}

export interface PdfPdfOptions {
  readonly format: "A4";
  readonly landscape: true;
  readonly printBackground: true;
  readonly preferCSSPageSize: true;
  readonly displayHeaderFooter: true;
  readonly headerTemplate: string;
  readonly footerTemplate: string;
  readonly margin: Readonly<{
    top: string;
    right: string;
    bottom: string;
    left: string;
  }>;
}

export interface PdfPage {
  setContent(html: string, options: PdfSetContentOptions): Promise<void>;
  waitForFonts(): Promise<void>;
  pdf(options: PdfPdfOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PdfBrowser {
  newPage(): Promise<PdfPage>;
  close(): Promise<void>;
}

export interface PdfBrowserFactory {
  launch(): Promise<PdfBrowser>;
}

export interface PlaywrightPdfBrowserFactoryOptions {
  readonly executablePath?: string;
}

export interface PdfReportExporterOptions {
  readonly browserFactory?: PdfBrowserFactory;
  readonly maxPages?: number;
}

export interface PdfRenderResult {
  readonly content: Buffer;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly pageCount: number;
}

export interface PdfPublishResult extends PdfRenderResult {
  readonly finalPath: string;
}

const DEFAULT_MAX_PAGES = 100;
const PDF_PRINT_CSS =
  "@page { size: A4 landscape; margin: 12mm; }\n" +
  "@media print {\n" +
  "  .report-shell { max-width: none; padding: 0; }\n" +
  "  .panel { break-inside: auto; }\n" +
  "  .panel__header { break-after: avoid; }\n" +
  "  thead { display: table-header-group; }\n" +
  "  tr { break-inside: avoid; }\n" +
  "  a { color: inherit; }\n" +
  "}";

const PDF_OPTIONS: PdfPdfOptions = {
  format: "A4",
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "",
  footerTemplate: "",
  margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
};

/** Renders the offline report through a network-blocked Chromium page and publishes atomically. */
export class PdfReportExporter {
  private readonly browserFactory: PdfBrowserFactory;
  private readonly maxPages: number;

  public constructor(options: PdfReportExporterOptions = {}) {
    const configuredExecutablePath = process.env.TEST_CENTER_PDF_EXECUTABLE_PATH?.trim();
    // Keep the bundled Playwright default, while allowing constrained machines to point at
    // an already-installed Chrome/Chromium binary without changing report generation code.
    this.browserFactory =
      options.browserFactory ??
      createPlaywrightPdfBrowserFactory(
        configuredExecutablePath === undefined || configuredExecutablePath === ""
          ? {}
          : { executablePath: configuredExecutablePath },
      );
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1) {
      throw new TypeError("PDF maxPages must be a positive safe integer.");
    }
  }

  public async render(model: ImmutableReportModel): Promise<PdfRenderResult> {
    const html = injectPdfPrintStyles(renderOfflineReport(model));
    const browser = await this.browserFactory.launch();
    let page: PdfPage | undefined;
    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFonts();
      const content = Buffer.from(await page.pdf(createPdfOptions(model)));
      const pageCount = countPdfPages(content);
      if (pageCount < 1) throw new Error("PDF renderer returned no pages.");
      if (pageCount > this.maxPages) {
        throw new Error(`PDF exceeds maximum page count of ${this.maxPages}.`);
      }
      return {
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
        sizeBytes: content.byteLength,
        pageCount,
      };
    } finally {
      try {
        await page?.close();
      } finally {
        await browser.close();
      }
    }
  }

  public async publish(model: ImmutableReportModel, finalPath: string): Promise<PdfPublishResult> {
    if (!isAbsolute(finalPath)) throw new TypeError("PDF export finalPath must be absolute.");
    const rendered = await this.render(model);
    const partialPath = `${finalPath}.partial`;
    await rm(partialPath, { force: true });
    try {
      await writeFile(partialPath, rendered.content);
      await rename(partialPath, finalPath);
    } catch (error) {
      await rm(partialPath, { force: true });
      throw error;
    }
    return { ...rendered, finalPath };
  }
}

/** Uses Playwright's browser context route as a second network boundary beyond the HTML CSP. */
export function createPlaywrightPdfBrowserFactory(
  options: PlaywrightPdfBrowserFactoryOptions = {},
): PdfBrowserFactory {
  if (options.executablePath !== undefined && !isAbsolute(options.executablePath)) {
    throw new TypeError("Playwright PDF executablePath must be absolute.");
  }
  return {
    async launch(): Promise<PdfBrowser> {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        headless: true,
        ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
      });
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.route("**/*", (route) => route.abort());
      return {
        async newPage(): Promise<PdfPage> {
          const page = await context.newPage();
          return {
            setContent: (html, options) => page.setContent(html, options),
            waitForFonts: async () => {
              await page.evaluate(() => {
                const browserGlobal = globalThis as typeof globalThis & {
                  document?: { fonts?: { ready?: Promise<unknown> } };
                };
                return browserGlobal.document?.fonts?.ready;
              });
            },
            pdf: (options) => page.pdf(options),
            close: () => page.close(),
          };
        },
        async close(): Promise<void> {
          try {
            await context.close();
          } finally {
            await browser.close();
          }
        },
      };
    },
  };
}

function createPdfOptions(model: ImmutableReportModel): PdfPdfOptions {
  return {
    ...PDF_OPTIONS,
    headerTemplate: `<div style="width:100%;padding:0 12mm;color:#52606d;font:9px Arial,sans-serif;">Unity Multi-Device Test Center / ${escapeHtmlText(model.run.packageName)} / ${escapeHtmlText(model.run.id)}</div>`,
    footerTemplate: `<div style="width:100%;padding:0 12mm;color:#52606d;font:9px Arial,sans-serif;text-align:right;">Run ${escapeHtmlText(model.run.id)} · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  };
}

function injectPdfPrintStyles(html: string): string {
  const headEnd = html.toLowerCase().lastIndexOf("</head>");
  if (headEnd < 0) throw new Error("Offline report HTML is missing a closing head tag.");
  const style = `<style id="pdf-print-style">${PDF_PRINT_CSS}</style>`;
  return `${html.slice(0, headEnd)}${style}${html.slice(headEnd)}`;
}

function countPdfPages(content: Buffer): number {
  return content.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}
