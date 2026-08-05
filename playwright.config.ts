import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";

const projectRoot = process.cwd();
const browserRoot = path.join(projectRoot, "data", "tools", "ms-playwright");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  outputDir: "output/playwright/test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4780",
    ...(existsSync(systemChrome) ? { launchOptions: { executablePath: systemChrome } } : {}),
    storageState: "data/e2e/storage-state.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 } } },
  ],
  webServer: {
    command: "powershell -ExecutionPolicy Bypass -File scripts/run-dev.ps1",
    url: "http://127.0.0.1:4780/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PLAYWRIGHT_BROWSERS_PATH: browserRoot, TEST_CENTER_SERVER_PORT: "4780" },
  },
});
