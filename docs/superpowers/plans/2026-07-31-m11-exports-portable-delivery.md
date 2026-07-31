# M11 Optional Exports and Portable Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable Excel/PDF/JUnit exports and deliver a verified portable Windows directory that performs a real one-device deploy/run/report flow from a clean E-drive extraction and remains stable for 60 minutes.

**Architecture:** Optional export jobs consume the immutable M10 report model and publish atomically without changing run completion. A deterministic packaging script assembles self-contained launcher, portable Node, production server/console dependencies, project-local Appium/UiAutomator2, Java/bundletool, scrcpy assets, Chromium PDF runtime, licenses, configuration templates, and documentation. A manifest hashes every shipped file and a clean-extraction verifier exercises the actual product.

**Tech Stack:** ExcelJS 4.4.0, Playwright Chromium 1.62.1 PDF, custom escaped JUnit XML, .NET 8 self-contained launcher, Node 22.23.1, PowerShell packaging, and Windows real-device/stability tests.

---

## Task 1: Implement Formula-Safe Excel Export

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/reports/src/spreadsheet-value.ts`
- Create: `packages/reports/src/spreadsheet-value.test.ts`
- Create: `packages/reports/src/excel-exporter.ts`
- Create: `packages/reports/src/excel-exporter.test.ts`
- Create: `tests/fixtures/reports/formula-values.json`

- [ ] **Step 1: Write failing formula/layout tests**

Inject values beginning `=`, `+`, `-`, `@`, tabs, CR/LF, and Unicode. Assert untrusted text is forced literal, date/number cells remain typed only from trusted model fields, worksheets are `Summary`, `Devices`, `Actions`, `Incidents`, `Evidence`, column widths are bounded, headers freeze/filter, hashes stay strings, and workbook re-open preserves values.

- [ ] **Step 2: Verify tests fail before ExcelJS is added**

Expected: missing exporter/dependency.

- [ ] **Step 3: Pin ExcelJS and implement value policy**

Add ExcelJS `4.4.0` exact. `safeSpreadsheetText` prefixes formula-leading or control-leading untrusted values with an apostrophe and records a sanitization counter. It never emits formulas/hyperlinks from device/log/user fields.

- [ ] **Step 4: Implement atomic workbook export**

Stream rows from the immutable model where possible, style compact headers/statuses, add evidence relative-path text, write `.partial`, close, hash, atomic rename, and register export attempt. Validate by reopening workbook and comparing row counts/key values.

- [ ] **Step 5: Run tests and commit**

```powershell
git add package.json package-lock.json packages/reports/src/spreadsheet-value* packages/reports/src/excel-exporter* tests/fixtures/reports/formula-values.json
git commit -m "feat: add safe Excel result export"
git push
```

## Task 2: Implement Offline PDF and Escaped JUnit XML Exports

**Files:**
- Create: `packages/reports/src/pdf-exporter.ts`
- Create: `packages/reports/src/pdf-exporter.test.ts`
- Create: `packages/reports/src/junit-exporter.ts`
- Create: `packages/reports/src/junit-exporter.test.ts`
- Create: `tests/security/export-output.test.ts`

- [ ] **Step 1: Write failing PDF/JUnit tests**

PDF: render only the already-sanitized local HTML with network denied, A4 landscape/print backgrounds, header/footer, bounded page count, long-table continuation, and valid `%PDF`. JUnit: one suite per run, one testcase per action/device, failures/errors/skips mapped deterministically, XML escaping, timestamps/durations, properties for artifact/serial/UID/generation, and no plaintext masked text.

- [ ] **Step 2: Verify tests fail**

Expected: missing exporters.

- [ ] **Step 3: Implement sandboxed PDF rendering**

Launch the pinned local Playwright Chromium executable with a fresh temporary profile and no network route; intercept and abort all non-`file:` requests. Load the ready HTML file, wait for fonts/layout, print to sibling partial, validate header/page count, hash/rename/register, and remove the profile.

- [ ] **Step 4: Implement JUnit XML without stringly unsafe fields**

Use one XML escaping function for text and a stricter attribute function. A device action failure creates `<failure type="CATEGORY">`; unknown/interrupted creates `<error>`; not targeted/cancelled-before-dispatch creates `<skipped>`. Include evidence paths/hashes in escaped `<system-out>`; redacted logs only.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/reports/src/pdf-exporter* packages/reports/src/junit-exporter* tests/security/export-output.test.ts
git commit -m "feat: add PDF and JUnit exports"
git push
```

## Task 3: Add Optional Export Jobs and User Selection

**Files:**
- Create: `packages/reports/src/export-service.ts`
- Create: `packages/reports/src/export-service.test.ts`
- Modify: `apps/server/src/routes/results.ts`
- Create: `apps/console/src/features/results/ExportMenu.tsx`
- Create: `apps/console/src/features/results/ExportJobs.tsx`
- Modify: `apps/console/src/features/results/RunResultView.tsx`
- Create: `apps/console/src/features/results/Exports.test.tsx`
- Create: `tests/e2e/exports.spec.ts`

- [ ] **Step 1: Write failing export job/UI tests**

Cover Excel/PDF/JUnit selection, one/all formats, pending/running/ready/failed, retry with new attempt, download/hash, browser refresh, concurrent duplicate idempotency, and exporter failure leaving the run/default HTML/ZIP completed and unchanged.

- [ ] **Step 2: Verify tests fail**

Expected: no optional export API/UI.

- [ ] **Step 3: Implement export service and API**

`POST /api/results/:runId/exports` accepts a nonempty set of `EXCEL|PDF|JUNIT`, CSRF, and idempotency key. Queue jobs with a concurrency of one PDF/two other exports. Consume only a ready immutable model; publish each attempt atomically. Optional failure never mutates `TestRun.state` or mandatory rows.

- [ ] **Step 4: Implement menu and job list**

Default result page continues to expose HTML/ZIP directly. A compact export menu uses checkboxes for Excel/PDF/JUnit and one Generate command. Show job state, created/finished time, size/hash, retry, and icon download; no format is silently selected except the user's current selection.

- [ ] **Step 5: Run tests/build and commit**

```powershell
git add packages/reports/src/export-service* apps/server/src/routes/results.ts apps/console/src/features/results tests/e2e/exports.spec.ts
git commit -m "feat: add selectable report exports"
git push
```

## Task 4: Assemble and Verify the Portable Windows Directory

**Files:**
- Create: `scripts/build-portable.ps1`
- Create: `scripts/verify-portable.ps1`
- Create: `scripts/write-release-manifest.mjs`
- Create: `config/settings.example.json`
- Create: `docs/user-guide.md`
- Create: `docs/device-onboarding.md`
- Create: `docs/deployment-and-signing.md`
- Create: `docs/session-recovery.md`
- Create: `docs/storage-and-cleanup.md`
- Create: `docs/maintenance.md`
- Create: `docs/build-provider-extension.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `tests/integration/portable-layout.test.ts`

- [ ] **Step 1: Write failing portable-layout tests**

Require `TestCenterLauncher.exe`, built server/console, portable Node, production `node_modules`, Appium/UiAutomator2 extension home, Java 17 runtime, bundletool 1.18.3, scrcpy 3.1 server/assets, Playwright Chromium, default config, docs/licenses, and `manifest.sha256.json`. Reject absolute build-machine paths, symlinks escaping root, dev/test caches, secrets, `data`, and imported apps/runs.

- [ ] **Step 2: Verify layout test fails before packaging**

Expected: portable output absent.

- [ ] **Step 3: Implement deterministic packaging**

Build console/server, publish self-contained launcher/helper, run production npm prune/copy in a staging directory, copy only verified tool assets/license files, provision an empty portable Appium home with exact driver, install/copy Chromium, normalize config, and generate a sorted per-file SHA-256/size/license-component manifest. Write final ZIP through partial/hash/rename under `dist/releases`.

- [ ] **Step 4: Implement clean extraction verifier**

Extract into a newly created E-drive directory outside the source tree, recompute all hashes, scan text/config/binaries metadata for source absolute paths/secrets, start launcher, run M0 self-check, navigate every page, then stop. Cleanup targets only the verifier's exact recorded extraction path after resolving it below the designated test root.

- [ ] **Step 5: Complete operating and extension documentation**

Document USB authorization/drivers, 1-4 selection, APK/AAB/installed flows, QA UID, signing profiles, failure policies/rejoin/no-auto-replay, reports/exports, retention thresholds, diagnostics, upgrades/rollback, remote repository workflow, and `BuildProvider` interface/event/cancellation test contract. Clearly mark Unity command build as not implemented.

- [ ] **Step 6: Run tests and commit**

```powershell
git add scripts/build-portable.ps1 scripts/verify-portable.ps1 scripts/write-release-manifest.mjs config docs THIRD_PARTY_NOTICES.md tests/integration/portable-layout.test.ts
git commit -m "build: assemble portable Windows delivery"
git push
```

## Task 5: Run Clean-Extraction Real-Device and 60-Minute Stability Acceptance

**Files:**
- Create: `tests/hardware/m11-portable-smoke.ts`
- Create: `tests/hardware/m11-stability.ts`
- Create: `tests/hardware/stability-analyzer.ts`
- Create: `docs/milestones/M11-acceptance.md`

- [ ] **Step 1: Run all automated and export validation**

Run unit/integration/UI/E2E/.NET/Unity/package-layout/security tests. Generate Excel/PDF/JUnit from normal/failed/interrupted models and reopen/parse each. Expected: zero failures.

- [ ] **Step 2: Run a real flow from clean extracted output**

From the extracted directory, not source, launch product; select explicit real serial; import/select a disposable APK/AAB or installed fixture; deploy/verify; read current-generation UID; run tap/swipe; finish; verify HTML/ZIP; request Excel/PDF/JUnit; validate hashes and open outputs. No source-tree executable/module may be loaded.

- [ ] **Step 3: Run 60-minute stability**

Keep one real device/session active for >=60 minutes with a deterministic safe action/checkpoint schedule, video leader profile, logcat, periodic screenshots, and report finalization. Sample process tree RSS/private bytes/handles/threads/CPU, queue depths, open file/socket counts, DB WAL size, and device temperatures every 10 seconds.

- [ ] **Step 4: Analyze memory and resource stability**

The thresholds are fixed in this plan before any acceptance samples exist. Discard the first 10 minutes, then analyze the remaining 50 minutes using Theil-Sen slope plus five-minute rolling medians. Fail on any crash/restart, worker/port/forward leak, frame/action queue depth above 2 for 30 consecutive seconds, post-checkpoint WAL above 64 MiB, process-tree private-byte slope above 1 MiB/minute with Kendall tau >=0.5, final five-minute private-byte median more than 128 MiB above the first post-warmup five-minute median, handle slope above 1/minute with final delta above 100, or thread slope above 0.1/minute with final delta above 10. Record raw samples, every derived statistic, threshold result, and analyzer version/hash. Changing a threshold requires a committed plan amendment before rerunning, never after viewing a failed result.

- [ ] **Step 5: Record final acceptance, commit, and push**

`docs/milestones/M11-acceptance.md` includes release ZIP/manifest hashes, clean path, real flow IDs, report/export hashes, 60-minute charts/statistics, known limitations, install/upgrade/rollback, and all M0-M11 acceptance links. Commit/push and verify clean branch.

- [ ] **Step 6: Stop before merging/releasing**

Present the branch and evidence to the user. Do not merge to `origin/main`, create a tag, GitHub Release, or delete the clean extraction until explicit final acceptance.
