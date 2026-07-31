# M2 Device Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover, identify, persist, and live-update one connected Android device through a typed serial-bound ADB adapter with no ambiguous or arbitrary shell execution.

**Architecture:** The ADB package exposes a closed command union that renders argument arrays with mandatory serial placement. A polling/track-devices source feeds a device registry whose persisted identity is keyed by serial and whose transient connection state is published through the existing snapshot/event stream. The Devices page reads authoritative API state and exposes diagnostics only.

**Tech Stack:** TypeScript, Zod, explicit Android SDK `adb.exe`, SQLite, Fastify, React, Vitest, Playwright, and one real Samsung device for acceptance.

---

## Task 1: Create the Closed Serial-Bound ADB Command Contract

**Files:**
- Create: `packages/contracts/src/device.ts`
- Create: `packages/adb/package.json`
- Create: `packages/adb/tsconfig.json`
- Create: `packages/adb/src/commands.ts`
- Create: `packages/adb/src/commands.test.ts`
- Create: `packages/adb/src/adb-client.ts`

- [ ] **Step 1: Write failing command-rendering tests**

Cover only the M2 commands: `devices -l`, `get-state`, `get-serialno`, `shell getprop <allowlisted-key>`, `shell wm size`, `shell wm density`, `shell dumpsys battery`, and `shell dumpsys display`. Assert every device-scoped command renders `-s <serial>` before the subcommand, rejects blank/whitespace serials, rejects unknown getprop keys, uses `shell: false`, and exposes no raw command variant.

```ts
expect(renderAdbCommand({ kind: "getProp", serial, key: "ro.build.version.sdk" })).toEqual([
  "-s", serial, "shell", "getprop", "ro.build.version.sdk",
]);
```

- [ ] **Step 2: Run tests and verify missing exports**

Expected: targeted Vitest run fails before implementation.

- [ ] **Step 3: Implement branded serial and closed unions**

`DeviceSerialSchema` trims and accepts only printable ADB serial characters. Export `AdbDiscoveryCommand` and `AdbDeviceCommand`; do not export a generic shell method. `AdbClient.execute(command)` selects the verified ADB path from M0 and delegates to `ProcessRunner` with 10-second default timeout and a 1 MiB output cap.

- [ ] **Step 4: Run tests and commit**

```powershell
git add packages/contracts/src/device.ts packages/adb
git commit -m "feat: add serial-bound adb adapter"
git push
```

## Task 2: Parse Discovery and Device Metadata Deterministically

**Files:**
- Create: `packages/adb/src/parse-devices.ts`
- Create: `packages/adb/src/parse-devices.test.ts`
- Create: `packages/adb/src/device-metadata.ts`
- Create: `packages/adb/src/device-metadata.test.ts`
- Create: `tests/fixtures/adb/devices-online.txt`
- Create: `tests/fixtures/adb/devices-mixed.txt`
- Create: `tests/fixtures/adb/device-metadata.json`

- [ ] **Step 1: Write failing recorded-output tests**

Fixtures include online, unauthorized, offline, missing model/product/device fields, extra whitespace, daemon banners, CRLF, and duplicate serial lines. Assert stable states `ONLINE`, `UNAUTHORIZED`, `OFFLINE`, `UNKNOWN`; never infer online from metadata alone.

- [ ] **Step 2: Verify parser tests fail**

Expected: missing parser/collector exports.

- [ ] **Step 3: Implement pure parsers and bounded metadata collection**

Parse key/value tokens after the serial/state columns without regex over the entire output. For online serials collect model, product, device, manufacturer, Android release/API, ABI list, physical/override size, density, orientation, battery percentage/charging, and display facts concurrently with a limit of four subprocesses per serial. Each unavailable field carries its own error category.

- [ ] **Step 4: Run tests and commit**

```powershell
git add packages/adb/src tests/fixtures/adb
git commit -m "feat: parse adb inventory metadata"
git push
```

## Task 3: Persist Device Identity and Connection State

**Files:**
- Create: `packages/database/src/migrations/0002_devices.sql`
- Create: `packages/devices/package.json`
- Create: `packages/devices/tsconfig.json`
- Create: `packages/devices/src/device-repository.ts`
- Create: `packages/devices/src/device-registry.ts`
- Create: `packages/devices/src/device-registry.test.ts`
- Create: `packages/devices/src/device-tags.ts`
- Create: `packages/devices/src/device-tags.test.ts`
- Create: `apps/server/src/routes/devices.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/ws/state-gateway.ts`

- [ ] **Step 1: Write failing lifecycle tests with a fake discovery clock**

Simulate online, unchanged poll, offline, disappearance, reappearance, and duplicate output. Assert one durable row per serial, monotonic `connectionSeq`, `lastSeenAt`, no duplicate device event for unchanged facts, and refresh metadata after reconnect.

- [ ] **Step 2: Verify lifecycle tests fail**

Expected: missing repository/registry.

- [ ] **Step 3: Add device tables and repository**

Migration creates `devices`, `device_connections`, and indexes by state/last-seen. Identity fields update only from successful metadata; transient failure never erases known model/version. Connection history is append-only.

- [ ] **Step 4: Implement registry polling and event publication**

Start with a two-second poll using `adb devices -l`; keep the source behind `DeviceDiscoverySource` so `track-devices` can replace polling later. Stop uses `AbortSignal`. Publish `device.upserted` and `device.connectionChanged` with complete versioned payloads.

- [ ] **Step 5: Add read-only APIs**

Implement `GET /api/devices` and `GET /api/devices/:serial`. Validate encoded serial, return 404 for unknown serial, and never accept an executable or raw ADB argument from HTTP.

- [ ] **Step 6: Add persisted tags and groups without device commands**

Allow validated human labels (1-40 characters, bounded count) and one optional group through CSRF-protected device metadata routes. Normalize case for uniqueness while preserving display text. Tag/group changes create audit events and never invoke ADB or change connection identity.

- [ ] **Step 7: Run tests and commit**

```powershell
git add packages/database/src/migrations/0002_devices.sql packages/devices apps/server/src/routes/devices.ts apps/server/src/app.ts apps/server/src/ws/state-gateway.ts
git commit -m "feat: persist live device inventory"
git push
```

## Task 4: Implement the Devices Operational Page

**Files:**
- Modify: `apps/console/src/pages/DevicesPage.tsx`
- Create: `apps/console/src/features/devices/device-api.ts`
- Create: `apps/console/src/features/devices/DeviceTable.tsx`
- Create: `apps/console/src/features/devices/DeviceDetails.tsx`
- Create: `apps/console/src/features/devices/ConnectionBadge.tsx`
- Create: `apps/console/src/features/devices/DeviceTagEditor.tsx`
- Create: `apps/console/src/features/devices/DevicesPage.test.tsx`

- [ ] **Step 1: Write failing table/state tests**

Cover empty, loading, online, unauthorized, offline, reconnecting, partial metadata, and stale state. Assert columns for serial, model, Android/API, ABI, resolution/orientation, battery, plus clearly labeled `Not available until M5` bridge/UID cells and `Not assigned` tag/occupancy cells. Long serials must wrap or ellipsize with a tooltip and never resize columns.

- [ ] **Step 2: Verify UI tests fail**

Expected: missing feature components.

- [ ] **Step 3: Implement table and diagnostic drawer**

Use a dense unframed table with fixed column tracks and state icons. Selecting a row opens a side drawer with exact known facts, field-level collection errors, last seen, connection history, and tag/group editor. The only device command in M2 is `Refresh`; tag edits are metadata-only, and no install, shell, or session controls appear.

- [ ] **Step 4: Run tests/build and commit**

```powershell
git add apps/console/src/pages/DevicesPage.tsx apps/console/src/features/devices
git commit -m "feat: add device inventory page"
git push
```

## Task 5: Verify the Current Samsung and Reconnect Timeline

**Files:**
- Create: `tests/hardware/m2-device-discovery.ts`
- Create: `tests/e2e/devices.spec.ts`
- Create: `docs/milestones/M2-acceptance.md`

- [ ] **Step 1: Add an opt-in serial-explicit hardware test**

Require `TEST_CENTER_DEVICE_SERIAL`; fail before any command when absent. Verify the serial appears online, model equals the live `getprop` result, API/ABI/display/battery facts are populated, and every captured process record has the same explicit serial.

- [ ] **Step 2: Add Playwright device states**

With fake discovery, test all states and a browser refresh during reconnect. Capture 1440x900 and 1024x768 screenshots and check no overlap.

- [ ] **Step 3: Run automated verification**

Run Vitest, TypeScript, ESLint, console build, and Playwright. Expected: zero failures.

- [ ] **Step 4: Run live connect/disconnect/reconnect acceptance**

Run the hardware test with the currently connected serial. Record the online snapshot, ask the user to unplug/replug only when the test prompts, then prove the same database row transitions online -> missing/offline -> online with no duplicate serial.

- [ ] **Step 5: Record, commit, push, and stop**

`docs/milestones/M2-acceptance.md` records commands, current device facts, timeline, limitations, and rollback. Commit/push the test and document, verify clean status, and stop for user acceptance. Do not import packages or start M3.
