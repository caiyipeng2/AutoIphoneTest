# M4 Single-Device Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install, optionally reset, launch, and verify one APK/AAB or selected installed identity with step-level state, safe retry, signer checks, and generation-aware UID invalidation.

**Architecture:** A persisted deployment state machine executes typed per-serial steps. APK uses serial-bound ADB; AAB creates a content-addressed signed install set from a device specification using explicit Java/bundletool. Keystore secrets stay in memory or Windows Credential Manager and reach bundletool through restricted temporary password files, never arguments/logs. Destructive mutations require server-bound one-time confirmation and advance installation/data generations transactionally.

**Tech Stack:** TypeScript, SQLite, typed ADB, Java 17, bundletool 1.18.3, .NET Windows Credential Manager helper, Fastify, React, Vitest, Playwright, and one real Android device.

---

## Task 1: Define the Deployment State Machine and Generation Model

**Files:**
- Create: `packages/contracts/src/deployment.ts`
- Create: `packages/database/src/migrations/0004_deployments.sql`
- Create: `packages/deployments/package.json`
- Create: `packages/deployments/tsconfig.json`
- Create: `packages/deployments/src/deployment-machine.ts`
- Create: `packages/deployments/src/deployment-machine.test.ts`
- Create: `packages/devices/src/installation-repository.ts`
- Create: `packages/devices/src/installation-repository.test.ts`

- [ ] **Step 1: Write failing transition and generation tests**

Cover `QUEUED -> PRECHECK -> PREPARE -> INSTALL -> VERIFY -> LAUNCH -> COMPLETED`, cancellation before a destructive step, retry from a failed step, and terminal `FAILED/CANCELLED`. Prove clear-data increments `appDataGeneration`, uninstall/reinstall increments `installGeneration` and `appDataGeneration`, and both invalidate current UID in the same transaction.

```ts
expect(() => transition("COMPLETED", { type: "RETRY" })).toThrow(/terminal/i);
expect(afterClear.appDataGeneration).toBe(before.appDataGeneration + 1);
expect(afterClear.currentUid).toBeNull();
```

- [ ] **Step 2: Run tests and verify missing implementation**

Expected: targeted tests fail.

- [ ] **Step 3: Add append-only deployment tables**

Create `deployments`, `deployment_devices`, `deployment_steps`, `device_app_installations`, and `device_uids`. A step attempt has stable step kind, attempt number, start/end, exit/error category, redacted log/evidence paths, and parent attempt. Never overwrite a completed attempt.

- [ ] **Step 4: Implement transition and generation transactions**

Only the orchestrator can transition state. `recordDataMutation()` updates generation and UID invalidation atomically before the destructive process starts, then records success/failure; a failed clear/uninstall remains auditable and triggers a fresh installation observation before use.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/contracts/src/deployment.ts packages/database/src/migrations/0004_deployments.sql packages/deployments packages/devices/src/installation-repository*
git commit -m "feat: add deployment state and app generations"
git push
```

## Task 2: Add Memory-Only and Windows Credential Manager Signing Profiles

**Files:**
- Create: `apps/credential-helper/TestCenter.CredentialHelper.sln`
- Create: `apps/credential-helper/src/TestCenter.CredentialHelper/TestCenter.CredentialHelper.csproj`
- Create: `apps/credential-helper/src/TestCenter.CredentialHelper/Program.cs`
- Create: `apps/credential-helper/src/TestCenter.CredentialHelper/CredentialStore.cs`
- Create: `apps/credential-helper/tests/TestCenter.CredentialHelper.Tests/CredentialStoreTests.cs`
- Create: `packages/deployments/src/signing-profile.ts`
- Create: `packages/deployments/src/signing-profile.test.ts`
- Create: `packages/deployments/src/credential-helper-client.ts`

- [ ] **Step 1: Write failing credential tests**

Test store/read/delete under a test-only target prefix, secret input through stdin, secret output captured only by a redacting client, no secret in arguments/stdout logs/exceptions, and memory-only profiles disappearing on service restart.

- [ ] **Step 2: Run .NET and Vitest tests and verify failure**

Expected: missing helper/client classes.

- [ ] **Step 3: Implement the Windows generic credential helper**

P/Invoke `CredWriteW`, `CredReadW`, `CredDeleteW`, and `CredFree`. Commands are fixed `put|get|delete`; target names must start `UnityMultiDeviceTestCenter/Signing/`. `put` reads UTF-8 secret from stdin, `get` writes only secret bytes to stdout, and all diagnostics go to stderr without values.

- [ ] **Step 4: Implement signing profiles**

Persist profile ID, display name, absolute keystore path, alias, certificate SHA-256, and credential target references. Default is memory-only. Validate keystore/certificate using explicit `keytool` without passwords in argv. At conversion time create ACL-restricted temporary password files under `data/temp/secrets/<operationId>`, pass only `file:<path>`, and delete them in `finally` after child exit.

- [ ] **Step 5: Run tests and commit**

```powershell
git add apps/credential-helper packages/deployments/src/signing-profile* packages/deployments/src/credential-helper-client.ts
git commit -m "feat: protect Android signing credentials"
git push
```

## Task 3: Implement APK and Device-Specific AAB Preparation

**Files:**
- Modify: `packages/adb/src/commands.ts`
- Modify: `packages/adb/src/commands.test.ts`
- Create: `packages/deployments/src/apk-installer.ts`
- Create: `packages/deployments/src/apk-installer.test.ts`
- Create: `packages/deployments/src/device-spec.ts`
- Create: `packages/deployments/src/aab-install-set.ts`
- Create: `packages/deployments/src/aab-install-set.test.ts`
- Create: `packages/database/src/migrations/0005_install_sets.sql`
- Create: `tests/fixtures/deployments/device-spec.json`

- [ ] **Step 1: Write failing command and cache-key tests**

Assert APK install renders `adb -s SERIAL install -r -t APK`; clear/uninstall/launch/package verification use closed commands. Assert AAB cache key contains bundle SHA-256, signer SHA-256, bundletool version, `DEVICE_SPECIFIC`, and canonical device-spec SHA-256. Different ABI/density/SDK cannot reuse a set.

- [ ] **Step 2: Verify tests fail**

Expected: missing installer/install-set modules.

- [ ] **Step 3: Extend the typed deployment command union**

Add `installApk`, `clearPackageData`, `uninstallPackage`, `startActivity`, `forceStop`, `foregroundActivity`, and `packagePid`. Validate package/activity syntax and local file containment below artifact storage.

- [ ] **Step 4: Verify the M3 project-local Java and bundletool runtime**

Run the M3 provisioning script idempotently and require the manifest-pinned Java/bundletool versions and hashes before any device-spec or build-apks test. M4 consumes those explicit paths and never falls back to `JAVA_HOME`, PATH, or a global bundletool.

- [ ] **Step 5: Implement device-specific bundletool flow**

Run explicit Java/bundletool `get-device-spec` for the selected serial and explicit ADB path. Canonicalize/hash the spec, check the install-set table, then run `build-apks` with the original bundle, keystore/alias, password files, and `--device-spec`. Write `.apks.partial`, hash, atomic rename, persist metadata, then verify archive contents/signing summary.

- [ ] **Step 6: Implement install and identity verification**

APK installs directly; AAB uses bundletool `install-apks --device-id=<serial> --adb=<explicit path>`. After install collect the M3 installed identity and require package/version/signer match. On mismatch mark deployment failed and never launch.

- [ ] **Step 7: Run tests and commit**

```powershell
git add packages/adb packages/deployments/src/apk-installer* packages/deployments/src/device-spec.ts packages/deployments/src/aab-install-set* packages/database/src/migrations/0005_install_sets.sql tests/fixtures/deployments
git commit -m "feat: prepare and install Android artifacts"
git push
```

## Task 4: Orchestrate Deployment, Confirmation, Launch, and Retry

**Files:**
- Create: `packages/deployments/src/deployment-orchestrator.ts`
- Create: `packages/deployments/src/deployment-orchestrator.test.ts`
- Create: `packages/security/src/destructive-confirmation.ts`
- Create: `packages/security/src/destructive-confirmation.test.ts`
- Create: `apps/server/src/routes/deployments.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/ws/state-gateway.ts`

- [ ] **Step 1: Write failing orchestration/security tests**

Cover a normal install, signer mismatch, clear-data confirmation, uninstall/reinstall confirmation, expired/reused/wrong-serial nonce, cancellation between steps, retry of only the failed safe step, foreground verification failure, and server restart marking an active deployment interrupted.

- [ ] **Step 2: Verify tests fail**

Expected: missing orchestrator/confirmation service.

- [ ] **Step 3: Implement server-bound confirmation**

Issue a random nonce hashed in storage and bound to session ID, operation kind, artifact, serial, package, generation snapshot, and 60-second expiry. Consume it in the same transaction that creates the destructive step; reject replay and changed target.

- [ ] **Step 4: Implement orchestration**

Precheck online/unoccupied serial and artifact identity; verify signer before overwrite; optionally mutate data; install; recollect identity; resolve/start activity; poll foreground/package PID with a bounded timeout; persist every step before/after execution. Retry creates a new attempt and never repeats a successful destructive step implicitly.

- [ ] **Step 5: Add authenticated APIs**

Add list/detail/create/cancel/retry routes plus confirmation issue/consume routes. M4 accepts exactly one serial. Return 409 for occupied/offline/mismatched state and never accept raw activities/commands not derived from artifact metadata.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/deployments/src/deployment-orchestrator* packages/security/src/destructive-confirmation* apps/server/src/routes/deployments.ts apps/server/src/app.ts apps/server/src/ws/state-gateway.ts
git commit -m "feat: orchestrate safe single-device deployment"
git push
```

## Task 5: Build the Deployments Page and Real-Device Acceptance

**Files:**
- Modify: `apps/console/src/pages/DeploymentsPage.tsx`
- Create: `apps/console/src/features/deployments/DeploymentForm.tsx`
- Create: `apps/console/src/features/deployments/DeploymentTimeline.tsx`
- Create: `apps/console/src/features/deployments/SigningProfileDialog.tsx`
- Create: `apps/console/src/features/deployments/DestructiveConfirmationDialog.tsx`
- Create: `apps/console/src/features/deployments/DeploymentsPage.test.tsx`
- Create: `tests/e2e/deployments.spec.ts`
- Create: `tests/hardware/m4-single-device-deployment.ts`
- Create: `docs/milestones/M4-acceptance.md`

- [ ] **Step 1: Write failing UI/E2E flows**

Cover artifact/device selection, APK/AAB distinction, signing profile memory/persist choice, clear-data warning, signer mismatch, per-step live status/log, cancel, retry, version mismatch, UID invalidated badge, and browser refresh.

- [ ] **Step 2: Implement the deployment work surface**

Use an unframed selection form and one step timeline. Destructive confirmation repeats package, serial, account/data impact, and expiry. Logs are escaped/redacted. Buttons have stable size and disabled reasons.

- [ ] **Step 3: Run complete automated verification**

Run Vitest, TypeScript, ESLint, console build, .NET helper tests, and Playwright. Expected: zero failures and no captured secret in logs/snapshots.

- [ ] **Step 4: Run real APK and AAB paths**

Require explicit serial, package, APK fixture, AAB fixture, and QA signing profile. Prove install/overwrite, installed identity, launch/foreground, clear-data invalidation, signer mismatch diagnostics, and step-safe retry. Use only a disposable QA package for destructive checks.

- [ ] **Step 5: Record, commit, push, and stop**

Document step logs, package/version/signer/digests, screenshot, secret-leak scan, UID generation change, limitations, and rollback. Commit/push `docs/milestones/M4-acceptance.md` and tests, verify clean branch, then stop for user acceptance. Do not start the Unity bridge.
