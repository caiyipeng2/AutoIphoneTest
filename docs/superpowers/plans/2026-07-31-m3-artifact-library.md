# M3 Artifact Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an immutable, deduplicated application library for APK, AAB, and explicitly observed installed-version identities without modifying imported source files.

**Architecture:** Streaming uploads are hashed into a temporary file, parsed through typed project-local Android/Java tools, and atomically published under content-addressed storage only after metadata validation succeeds. Installed references are a distinct artifact kind containing package/version/signer/installed-set identity and never pretend to own a source bundle.

**Tech Stack:** Fastify multipart streaming, Node crypto/streams, SQLite, `aapt2`, `apksigner`, bundletool 1.18.3, explicit Java, React, Vitest, and Playwright.

---

## Task 1: Define Artifact Identities and Atomic Content Storage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/contracts/src/artifact.ts`
- Create: `packages/database/src/migrations/0003_artifacts.sql`
- Create: `packages/artifacts/package.json`
- Create: `packages/artifacts/tsconfig.json`
- Create: `packages/artifacts/src/content-store.ts`
- Create: `packages/artifacts/src/content-store.test.ts`
- Create: `packages/artifacts/src/artifact-repository.ts`
- Create: `packages/artifacts/src/artifact-repository.test.ts`

- [ ] **Step 1: Write failing atomic-store tests**

Test streaming SHA-256, duplicate bytes under different names, partial write failure, metadata-transaction failure, and source-file immutability. Final path must be `data/artifacts/sha256/<first-two>/<full-hash>/<sanitized-original-name>` and only appear after close/hash/rename.

```ts
const first = await store.stage(readable("same bytes"), "game.apk");
const second = await store.stage(readable("same bytes"), "renamed.apk");
expect(first.sha256).toBe(second.sha256);
expect(await store.publish(first)).toEqual(await store.publish(second));
```

- [ ] **Step 2: Run tests and verify missing package failure**

Expected: targeted Vitest run fails.

- [ ] **Step 3: Add artifact schemas and tables**

Create discriminated `AppArtifact` kinds `APK`, `AAB`, and `INSTALLED`. Source artifacts require SHA-256/size/stored path; installed artifacts require device serial, observation time, signer SHA-256, and installed-set SHA-256 or QA build ID. Tables separate immutable content, artifact metadata, notes/tags, and import attempts.

- [ ] **Step 4: Pin the streaming multipart dependency**

Add `@fastify/multipart` `10.1.0` exact, update `package-lock.json` with portable npm, and require `npm ls --all` exit 0. Configure limits in route code; never buffer the whole upload.

- [ ] **Step 5: Implement staging/publish transaction**

Sanitize display names without using them as identity. Write `.partial` beside the final content directory, compute hash while streaming, fsync/close, then transactionally insert metadata and atomically rename. On any error, remove only the known temporary path and record a failed import attempt without an artifact row.

- [ ] **Step 6: Run tests and commit**

```powershell
git add package.json package-lock.json packages/contracts/src/artifact.ts packages/database/src/migrations/0003_artifacts.sql packages/artifacts
git commit -m "feat: add immutable artifact storage"
git push
```

## Task 2: Parse APK and AAB Metadata Through Typed Tools

**Files:**
- Create: `packages/artifacts/src/tool-commands.ts`
- Create: `packages/artifacts/src/apk-metadata.ts`
- Create: `packages/artifacts/src/aab-metadata.ts`
- Create: `packages/artifacts/src/metadata-parser.test.ts`
- Create: `tests/fixtures/artifacts/apk-badging.txt`
- Create: `tests/fixtures/artifacts/apk-certs.txt`
- Create: `tests/fixtures/artifacts/aab-manifest.xml`
- Create: `tests/fixtures/artifacts/aab-certs.txt`
- Create: `tests/fixtures/artifacts/invalid.bin`
- Create: `scripts/provision-java-bundletool.ps1`
- Create: `tests/bootstrap/provision-java-bundletool.tests.ps1`

- [ ] **Step 1: Write failing parser tests**

Assert package name, version name/code, min/target SDK, launch activity, supported ABIs, debuggable flag, signing certificate SHA-256, and parse-tool versions. Cover quoted values, missing launch activity, malformed output, wrong extension with valid bytes, and an invalid ZIP. Bootstrap tests use a temporary tool root to prove wrong hashes never publish Java/bundletool, correct cached archives provision atomically, and reruns are idempotent.

- [ ] **Step 2: Verify tests fail**

Expected: missing provisioning script and metadata parsers.

- [ ] **Step 3: Provision explicit Java and bundletool without global changes**

`scripts/provision-java-bundletool.ps1` reads the M0 manifest, downloads Eclipse Temurin JDK `17.0.19+10` and bundletool `1.18.3` to partial paths, verifies vendor SHA-256, atomically publishes under `tools\java\17.0.19+10` and `tools\bundletool\1.18.3`, then runs explicit `java.exe -version`, `jarsigner.exe -help`, and `java.exe -jar bundletool.jar version`. It never changes `JAVA_HOME` or PATH.

- [ ] **Step 4: Implement closed parse commands**

APK uses explicit SDK `aapt2 dump badging` and `apksigner verify --print-certs`. AAB uses explicit project Java plus `bundletool dump manifest --bundle <path>` and `jarsigner -verify -certs`. All paths are separate arguments; no shell interpolation. Validate ZIP magic/content before tool launch and classify `INVALID_FORMAT`, `TOOL_FAILURE`, `UNSIGNED`, or `UNSUPPORTED_METADATA`.

- [ ] **Step 5: Return immutable normalized metadata**

Normalize certificate hex, preserve original version strings, store tool paths/versions, and never infer a launch activity for AAB. Parser results are Zod-validated before the content publish transaction.

- [ ] **Step 6: Run provisioning, tests, and commit**

```powershell
git add packages/artifacts/src tests/fixtures/artifacts scripts/provision-java-bundletool.ps1 tests/bootstrap/provision-java-bundletool.tests.ps1
git commit -m "feat: parse Android package metadata"
git push
```

## Task 3: Register an Installed-Version Identity

**Files:**
- Modify: `packages/adb/src/commands.ts`
- Modify: `packages/adb/src/commands.test.ts`
- Create: `packages/artifacts/src/installed-identity.ts`
- Create: `packages/artifacts/src/installed-identity.test.ts`
- Create: `tests/fixtures/adb/pm-path.txt`
- Create: `tests/fixtures/adb/dumpsys-package.txt`

- [ ] **Step 1: Write failing installed-identity tests**

Require explicit serial/package and closed commands for `pm path`, `dumpsys package`, `cmd package resolve-activity`, certificate digest collection, and streaming each installed base/split APK through host SHA-256. Sort paths before building the installed-set digest. Reject mixed package names or a disappeared split.

- [ ] **Step 2: Verify tests fail before adding commands**

Expected: command union and collector do not support installed identity.

- [ ] **Step 3: Extend the ADB allowlist narrowly**

Add typed `packagePaths`, `packageDetails`, `resolveActivity`, and `streamPackageFile` commands. Validate package names with `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`; package file paths must come from the immediately preceding `pm path` response and remain below `/data/app/`.

- [ ] **Step 4: Implement deterministic installed identity**

Collect package/version/activity/signer, hash base and splits, then hash canonical JSON of sorted `{ pathRole, sha256 }` records. Persist an `INSTALLED` artifact with no source/stored path. Re-observation deduplicates only when package, version, signer, and installed-set digest all match.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/adb packages/artifacts/src/installed-identity.ts packages/artifacts/src/installed-identity.test.ts tests/fixtures/adb
git commit -m "feat: register installed app identities"
git push
```

## Task 4: Establish BuildProvider and ArtifactImportProvider Contracts

**Files:**
- Create: `packages/build-provider/package.json`
- Create: `packages/build-provider/tsconfig.json`
- Create: `packages/build-provider/src/build-provider.ts`
- Create: `packages/build-provider/src/artifact-import-provider.ts`
- Create: `packages/build-provider/src/artifact-import-provider.test.ts`

- [ ] **Step 1: Write failing provider contract tests**

Require `BuildProvider.id`, `validate(request)`, `build(request, events)`, and `cancel(buildId)`. Assert `ArtifactImportProvider` accepts only existing APK/AAB paths below an explicitly selected import source, delegates bytes/metadata to the immutable artifact service, emits ordered validate/hash/parse/publish events, returns the existing deduplicated artifact, and cancellation leaves no final artifact or partial file.

- [ ] **Step 2: Verify tests fail**

Expected: build-provider package does not exist.

- [ ] **Step 3: Implement the stable interface and import provider**

Define Zod-backed `BuildRequest`, `BuildValidation`, `BuildEvent`, `BuildEventSink`, and `AppArtifactRef`. The only registered first-version provider is `artifact-import`; provider lookup rejects unknown IDs. Do not add Unity executable/project/method fields to the import request.

- [ ] **Step 4: Prove future-provider independence**

Add a test-only fake provider that returns an `AppArtifactRef` through the same interface, then assert Apps/deployment-facing code consumes the reference without inspecting provider type. This is the extension seam for `UnityCommandBuildProvider`; no Unity build is invoked or represented as available.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/build-provider
git commit -m "feat: reserve build provider extension"
git push
```

## Task 5: Expose Import APIs and the Apps Page

**Files:**
- Create: `apps/server/src/routes/artifacts.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/console/src/features/artifacts/artifact-api.ts`
- Create: `apps/console/src/features/artifacts/ArtifactTable.tsx`
- Create: `apps/console/src/features/artifacts/ImportArtifactDialog.tsx`
- Create: `apps/console/src/features/artifacts/RegisterInstalledDialog.tsx`
- Modify: `apps/console/src/pages/AppsPage.tsx`
- Create: `apps/console/src/features/artifacts/AppsPage.test.tsx`

- [ ] **Step 1: Write failing API/UI tests**

Cover streamed APK/AAB upload, duplicate import response, invalid file cleanup, upload size limit, aborted upload, installed registration, filters, immutable hash display, no source path for installed records, and escaped notes/names.

- [ ] **Step 2: Verify tests fail**

Expected: 404/missing components.

- [ ] **Step 3: Implement authenticated APIs**

Add `GET /api/artifacts`, `GET /api/artifacts/:id`, `POST /api/artifacts/import`, and `POST /api/artifacts/installed`. Imports require CSRF and multipart file size caps; installed registration requires a currently online serial and typed package name. Response distinguishes `CREATED`, `DEDUPLICATED`, and `REJECTED`.

- [ ] **Step 4: Implement Apps page workflows**

Use a dense table with kind, package, version, signer summary, size, imported/observed time, hash, channel, and notes. Import and installed-version actions are explicit buttons; progress/errors appear in a real dialog, not a nested card. Never label installed records as APK/AAB files.

- [ ] **Step 5: Run tests/build and commit**

```powershell
git add apps/server/src/routes/artifacts.ts apps/server/src/app.ts apps/console/src/features/artifacts apps/console/src/pages/AppsPage.tsx
git commit -m "feat: add application artifact library"
git push
```

## Task 6: Verify Deduplication, Invalid Rollback, and Live Installed Identity

**Files:**
- Create: `tests/integration/artifact-import.test.ts`
- Create: `tests/e2e/apps.spec.ts`
- Create: `tests/hardware/m3-installed-identity.ts`
- Create: `docs/milestones/M3-acceptance.md`

- [ ] **Step 1: Add integration and E2E cases**

Import the same valid fixture twice under different names, corrupt a stream halfway, import invalid bytes, register an installed identity twice, refresh the browser, and verify content/ref counts plus zero orphan final/partial files.

- [ ] **Step 2: Run complete automated verification**

Run Vitest, TypeScript, ESLint, console build, and Playwright. Expected: zero failures.

- [ ] **Step 3: Run one real installed-identity collection**

Require explicit `TEST_CENTER_DEVICE_SERIAL` and `TEST_CENTER_PACKAGE`. Compare collected package/version/activity/signer with direct serial-bound diagnostic commands and record the installed-set digest. Do not install, clear, or launch anything in M3.

- [ ] **Step 4: Record, commit, push, and stop**

Document hashes, rollback proof, page screenshots, real observation, limitations, and rollback in `docs/milestones/M3-acceptance.md`. Commit/push, verify a clean branch, and stop for user acceptance. Do not begin deployment.
