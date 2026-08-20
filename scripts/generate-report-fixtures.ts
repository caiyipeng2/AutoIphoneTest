import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  createReportFixture,
  type ReportFixtureScenario,
} from "../tests/integration/report-fixtures.js";

const scenarios: readonly ReportFixtureScenario[] = ["normal", "failure", "interrupted"];

const outputRoot = resolve(readArgument("--output-root") ?? "output/playwright/report-fixtures");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const scenario of scenarios) {
  const fixture = await createReportFixture(scenario);
  try {
    await fixture.finalize();
    const runId = `fixture-${scenario}`;
    const reportsRoot = join(fixture.runRoot, runId, "reports");
    const destinationRoot = join(outputRoot, scenario);
    await mkdir(destinationRoot, { recursive: true });
    await copyFile(join(reportsRoot, "report-1.html"), join(destinationRoot, "report.html"));
    await copyFile(join(reportsRoot, "evidence-1.zip"), join(destinationRoot, "evidence.zip"));
    await writeFile(
      join(destinationRoot, "fixture.json"),
      `${JSON.stringify({ scenario, runId }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await fixture.close();
  }
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
