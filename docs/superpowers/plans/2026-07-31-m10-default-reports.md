# M10 Default Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize normal, failed, and interrupted runs into searchable history, a secure offline HTML report, and a hashed evidence ZIP with explicit mandatory-capture outcomes and crash-safe publication.

**Architecture:** SQLite is authoritative. Evidence/report rows move `PENDING -> READY|FAILED|MISSING` through sibling temporary files, close/hash/atomic rename, then a transaction. Finalization builds a sanitized immutable report model, renders static HTML, streams ZIP64 with a manifest, and marks the run `COMPLETED` only when both mandatory outputs are ready; otherwise `FINALIZATION_FAILED` can retry without device actions.

**Tech Stack:** TypeScript, SQLite, streaming Node I/O, Archiver 8.0.0 ZIP64, static HTML/CSS, React Results page, Vitest, Playwright, and forced process-crash integration tests.

---

## Task 1: Enforce Evidence States, Redaction, and Mandatory Capture Matrix

**Files:**
- Create: `packages/database/src/migrations/0009_evidence_reports.sql`
- Modify: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/report.ts`
- Create: `packages/evidence/src/evidence-repository.ts`
- Create: `packages/evidence/src/atomic-publisher.ts`
- Create: `packages/evidence/src/atomic-publisher.test.ts`
- Create: `packages/evidence/src/mandatory-capture.ts`
- Create: `packages/evidence/src/mandatory-capture.test.ts`
- Create: `packages/evidence/src/log-redactor.ts`
- Create: `packages/evidence/src/log-redactor.test.ts`
- Create: `packages/evidence/src/logcat-evidence.ts`
- Create: `packages/evidence/src/logcat-evidence.test.ts`

- [ ] **Step 1: Write failing publication/matrix tests**

Test close/hash/rename ordering, same-directory temp files, write/hash/rename/DB failure, startup orphan reconciliation, and allowed unavailable reasons. For connected failure require screenshot/foreground/redacted logcat/mapped input/Appium timing; bridge-ready adds state/arm/ACK; disconnected requires buffered logs plus explicit live-capture unavailable records.

```ts
expect(evaluateMandatoryCapture(connectedFailureWithoutScreenshot)).toEqual({
  passed: false,
  missing: ["CURRENT_SCREENSHOT"],
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: missing evidence schema/publisher/matrix.

- [ ] **Step 3: Add evidence/report tables and atomic publisher**

Create evidence/report attempts with stable IDs, association, serial/type/state, temp/final relative paths, SHA-256, size, capture error category, timestamps, and attempt. Resolve all paths under the run root. Publisher writes `.partial-<attempt>`, closes, hashes, atomic-renames, then marks ready. Startup marks orphaned pending rows categorized failed/missing and never treats an existing partial as final.

- [ ] **Step 4: Implement redaction before persistence/export**

Read only M6 manifest-registered, serial-owned logcat segments through a bounded streaming parser; reject paths, serials, hashes, or time ranges that do not match the evidence manifest. Filter configured secrets, text action values/escaped forms, bearer/cookie/CSRF/bootstrap material, keystore passwords, and common access-token patterns before writing the report-owned redacted derivative. Preserve timestamp/tag/category, cap excerpts by bytes/time, and record source hash plus truncation. Redaction failures block publication rather than exporting raw input.

- [ ] **Step 5: Implement mandatory evaluation**

Return every ready/missing/failed item and allowed reason. Only `DEVICE_DISCONNECTED`, `PROCESS_ABSENT`, or `SOURCE_NOT_APPLICABLE` can satisfy specifically mapped unavailable cases. Generic capture errors fail the gate.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/database/src/migrations/0009_evidence_reports.sql packages/contracts/src/report.ts packages/contracts/src/session.ts packages/evidence
git commit -m "feat: make evidence publication transactional"
git push
```

## Task 2: Build a Sanitized Immutable Report Model and Offline HTML

**Files:**
- Create: `packages/reports/package.json`
- Create: `packages/reports/tsconfig.json`
- Create: `packages/reports/src/report-model.ts`
- Create: `packages/reports/src/report-model.test.ts`
- Create: `packages/reports/src/html-escape.ts`
- Create: `packages/reports/src/html-escape.test.ts`
- Create: `packages/reports/src/html-renderer.ts`
- Create: `packages/reports/src/html-renderer.test.ts`
- Create: `packages/reports/src/assets/report.css`
- Create: `tests/fixtures/reports/hostile-values.json`

- [ ] **Step 1: Write failing model/escaping tests**

Build normal, failed, and interrupted models. Inject HTML/script/style/URL payloads through device name, serial, UID, package, action text metadata, log excerpt, notes, and error. Assert text escaping, no executable script/external resource, local relative evidence links only, missing evidence labels, and deterministic ordering/hashes.

- [ ] **Step 2: Verify tests fail**

Expected: missing reports package.

- [ ] **Step 3: Implement immutable model query**

Within one read transaction load run snapshot, artifact/installed identity, members/UIDs/generations, actions/targets/results/timings/uncertainty, incidents/recoveries, evidence states, and export attempts. Freeze/validate through `OfflineReportModelSchema`; include explicit partial/interrupted/finalization status.

- [ ] **Step 4: Implement dependency-free offline HTML**

Render UTF-8 HTML with inline static CSS, no JavaScript, no remote fonts/assets, restrictive meta CSP, summary, device matrix, action timeline, failures/recovery, metrics eligibility, evidence links/hashes, missing reasons, and generation identities. Encode every text/attribute separately and reject non-relative links.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/reports/src tests/fixtures/reports
git commit -m "feat: render secure offline HTML reports"
git push
```

## Task 3: Stream a ZIP64 Evidence Bundle with Verified Manifest

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/reports/src/zip-manifest.ts`
- Create: `packages/reports/src/zip-manifest.test.ts`
- Create: `packages/reports/src/evidence-zip.ts`
- Create: `packages/reports/src/evidence-zip.test.ts`
- Create: `tests/fixtures/reports/small-evidence-tree/README.txt`

- [ ] **Step 1: Write failing ZIP tests**

Assert canonical forward-slash entry names, no absolute/traversal paths, one manifest with every included entry/size/SHA-256/type/association, ZIP64 enabled, streaming without whole-file buffering, partial cleanup on failure, final ZIP SHA-256, and independent extraction/manifest verification.

- [ ] **Step 2: Verify tests fail before adding Archiver**

Expected: missing ZIP module/dependency.

- [ ] **Step 3: Pin Archiver and implement canonical manifest**

Add Archiver `8.0.0` and `@types/archiver` `8.0.0` exact. Build sorted manifest from `READY` evidence and the HTML report; include unavailable/failed records as metadata without nonexistent file entries. Normalize paths and reject duplicates/case-insensitive collisions.

- [ ] **Step 4: Stream ZIP64 atomically**

Use file streams, force ZIP64, listen for warning/error/close, write sibling partial, close, hash final bytes, atomic rename, and mark ready. A verifier reopens the archive, hashes entries while streaming, and compares with manifest before run completion.

- [ ] **Step 5: Run tests and commit**

```powershell
git add package.json package-lock.json packages/reports/src/zip-manifest* packages/reports/src/evidence-zip* tests/fixtures/reports/small-evidence-tree
git commit -m "feat: publish verified evidence ZIP64"
git push
```

## Task 4: Implement Finalization Recovery and Results History

**Files:**
- Create: `packages/reports/src/finalization-service.ts`
- Create: `packages/reports/src/finalization-service.test.ts`
- Modify: `packages/sessions/src/run-repository.ts`
- Create: `apps/server/src/routes/results.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/console/src/pages/ResultsPage.tsx`
- Create: `apps/console/src/features/results/RunHistoryTable.tsx`
- Create: `apps/console/src/features/results/RunResultView.tsx`
- Create: `apps/console/src/features/results/EvidencePanel.tsx`
- Create: `apps/console/src/features/results/ResultsPage.test.tsx`

- [ ] **Step 1: Write failing finalization/state tests**

Cover normal finish, failed action, stale PREFLIGHT/RUNNING/PAUSED/RECOVERING/FINALIZING on startup, HTML failure, ZIP failure, retry finalization, concurrent retry rejection, and no device/action call during retry. Require `FINALIZING`, `COMPLETED`, `FINALIZATION_FAILED`, `ABORTED`, and `INTERRUPTED` semantics.

- [ ] **Step 2: Verify tests fail**

Expected: current run finish stops at evidence manifest.

- [ ] **Step 3: Implement finalization service**

Acquire a DB lease, close/fence workers, reconcile nonterminal actions/evidence, evaluate mandatory matrix, publish HTML then ZIP, verify both, and mark completed. Failure records attempt/error and sets `FINALIZATION_FAILED`. Startup interrupts stale live/finalizing runs and attempts a partial report once; manual retry only runs report code.

- [ ] **Step 4: Add read-only history and retry API**

List/filter by time, artifact, device serial/UID, state, and failure. Detail returns immutable result/evidence/export state. `POST /api/results/:runId/retry-finalization` requires CSRF/idempotency and permits only interrupted/finalization-failed records with no live workers.

- [ ] **Step 5: Implement Results page**

Use a dense history table and unframed detail view with summary, member/UID identities, action/device results, incidents/recovery, metrics/uncertainty, evidence readiness/missing reason, HTML open, ZIP download/hash, and finalization retry when eligible. Opening history never issues an action command.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/reports/src/finalization-service* packages/sessions/src/run-repository.ts apps/server/src/routes/results.ts apps/server/src/app.ts apps/console/src/pages/ResultsPage.tsx apps/console/src/features/results
git commit -m "feat: finalize and browse test results"
git push
```

## Task 5: Enforce Storage Pressure, Retention, and Audited Cleanup

**Files:**
- Create: `packages/evidence/src/storage-policy.ts`
- Create: `packages/evidence/src/storage-policy.test.ts`
- Create: `packages/evidence/src/cleanup-service.ts`
- Create: `packages/evidence/src/cleanup-service.test.ts`
- Create: `apps/server/src/routes/storage.ts`
- Modify: `apps/console/src/pages/OverviewPage.tsx`
- Modify: `apps/console/src/pages/SettingsPage.tsx`
- Create: `apps/console/src/features/storage/CleanupDialog.tsx`
- Create: `apps/console/src/features/storage/StoragePolicy.test.tsx`

- [ ] **Step 1: Write failing threshold/cleanup tests**

Cover warning below 20 GiB, block new videos/new runs below 5 GiB, existing action/evidence writes continuing with explicit pressure incidents, 30-day candidates, protected runs, estimated bytes, original imported artifacts excluded, active/finalizing runs excluded, confirmation nonce, path containment, partial deletion failure, and append-only cleanup audit.

- [ ] **Step 2: Verify tests fail**

Expected: no storage policy/cleanup service.

- [ ] **Step 3: Implement policy and gates**

Poll free space and recent write rate; publish normal/warning/danger state. Run/video creation checks the current state transactionally. Retention query returns candidates and exact referenced evidence/report bytes; it never includes immutable imported artifact content unless a separate artifact-delete feature is designed and approved.

- [ ] **Step 4: Implement recoverable, audited cleanup**

Require server-issued destructive confirmation bound to sorted run IDs and expected bytes. Mark runs `DELETING`, move owned run directories into `data/trash/<cleanupId>` on the same volume, delete metadata/files with per-item results, and retain an audit manifest. On failure, preserve/move back recoverable entries and label unresolved paths; never issue a recursive operation outside validated run/trash roots.

- [ ] **Step 5: Implement Overview/Settings storage UI**

Overview shows free space, pressure status, estimated time/bytes at current write rate, and active run impact. Settings owns thresholds/retention/protected-run cleanup preview. Cleanup dialog lists exact runs/bytes and recovery/audit outcome; no one-click silent deletion.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/evidence/src/storage-policy* packages/evidence/src/cleanup-service* apps/server/src/routes/storage.ts apps/console/src/pages/OverviewPage.tsx apps/console/src/pages/SettingsPage.tsx apps/console/src/features/storage
git commit -m "feat: enforce evidence retention and storage safety"
git push
```

## Task 6: Prove Normal, Failure, Interrupted, and Crash-During-Write Reports

**Files:**
- Create: `tests/integration/report-finalization.test.ts`
- Create: `tests/integration/report-crash-worker.ts`
- Create: `tests/e2e/results.spec.ts`
- Create: `tests/security/report-output.test.ts`
- Create: `scripts/verify-report.ps1`
- Create: `docs/milestones/M10-acceptance.md`

- [ ] **Step 1: Generate three deterministic report fixtures**

Create normal, multi-device failure/recovery, and interrupted runs with connected/disconnected evidence cases. Finalize, shut down the service, then open HTML and verify ZIP using only files.

- [ ] **Step 2: Force crashes at every publication boundary**

Terminate child finalizer after temp create, mid-write, after close, after hash, after rename, and before DB ready. Restart and assert no partial file is published, pending rows reconcile, retry succeeds, and no action/worker call occurs.

- [ ] **Step 3: Run security/integrity checks**

Inject hostile HTML, formulas, token/secret patterns, Unicode paths, duplicate/case-colliding names, and >4 GiB sparse/stream simulation. Require escaping/redaction, formula-neutral shared values, ZIP64 flag/manifest validation, and no external resource requests.

- [ ] **Step 4: Run complete verification and visual inspection**

Run all automated suites, open each offline HTML in Playwright with network blocked, capture screenshots at desktop widths, inspect long logs/tables, and verify no overlap/truncation that hides failure data.

- [ ] **Step 5: Record, commit, push, and stop**

Document fixture/report/ZIP hashes, matrix evaluation, crash table, security scan, screenshots, limitations, and rollback in `docs/milestones/M10-acceptance.md`. Commit/push and stop for explicit user acceptance. Do not add Excel/PDF/JUnit or portable packaging before approval.
