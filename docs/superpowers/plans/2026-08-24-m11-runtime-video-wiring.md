# M11 Runtime Video Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing serial-bound Tango scrcpy `ViewProvider` to the portable server runtime so an authenticated video WebSocket can start a real H.264 stream for an online Android device and release it when the device or server goes away.

**Architecture:** Keep scrcpy protocol and ADB ownership inside `@test-center/video`. Add a small server-side runtime coordinator that observes `DeviceRegistry` events, creates providers only for configured online devices, starts a provider on the first authenticated WebSocket subscriber, and stops/removes it when the device becomes unavailable or the runtime closes. The existing gateway contract and console frame format remain unchanged.

**Tech Stack:** TypeScript, Fastify WebSocket, Vitest, `AdbScrcpyVideoTransport`, `TangoScrcpyViewProvider`, `DeviceRegistry`.

---

### Task 1: Define the runtime video coordinator contract

**Files:**
- Create: `apps/server/src/runtime-video.ts`
- Test: `apps/server/src/runtime-video.test.ts`
- Modify: `apps/server/src/device-runtime.ts`

- [ ] **Step 1: Write the failing tests**

Cover these observable behaviors with injected provider factories and a fake device registry:

```typescript
it("creates a provider for each online device and starts it on demand", async () => {
  const runtime = createRuntimeVideoCoordinator({
    registry,
    createProvider: (serial) => providers.get(serial)!,
  });
  registry.emitOnline("R5CX211TXNT");
  const provider = runtime.providers.get("R5CX211TXNT");
  expect(provider).toBeDefined();
  await runtime.start("R5CX211TXNT");
  expect(provider?.start).toHaveBeenCalledOnce();
});

it("stops and removes a provider when its device leaves online state", async () => {
  const runtime = createRuntimeVideoCoordinator({ ... });
  registry.emitOnline("R5CX211TXNT");
  registry.emitOffline("R5CX211TXNT");
  expect(provider.stop).toHaveBeenCalledOnce();
  expect(runtime.providers.has("R5CX211TXNT")).toBe(false);
});

it("stops every provider and unsubscribes on close", async () => {
  const runtime = createRuntimeVideoCoordinator({ ... });
  registry.emitOnline("R5CX211TXNT");
  await runtime.close();
  expect(provider.stop).toHaveBeenCalledOnce();
  expect(registry.unsubscribe).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

Run `npm exec vitest run apps/server/src/runtime-video.test.ts`.

Expected: fail because `runtime-video.ts` and the coordinator factory do not exist yet.

- [ ] **Step 3: Implement the minimal coordinator**

Expose `providers: Map<string, ViewProvider>`, `start(serial)`, and `close()`. Subscribe once to `DeviceRegistry`; create a provider for `ONLINE`, stop/remove it for any other state, and stop all providers during close. Make `start` idempotent by delegating to the provider's own `start()`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `npm exec vitest run apps/server/src/runtime-video.test.ts` and expect all coordinator tests to pass.

### Task 2: Wire the coordinator to the portable scrcpy assets

**Files:**
- Modify: `apps/server/src/device-runtime.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/dev.ts`
- Test: `apps/server/src/device-runtime.test.ts`

- [ ] **Step 1: Add a failing factory test**

Inject `TEST_CENTER_ADB_PATH` and `TEST_CENTER_SCRCPY_SERVER_PATH`, create the runtime registry with a fake registry/device source, and assert that the returned `viewProviders` map contains a `TangoScrcpyViewProvider` factory result bound to the observed serial. Assert that an absent server asset disables the map without throwing during server startup.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npm exec vitest run apps/server/src/device-runtime.test.ts -t "view provider"`.

Expected: fail because `RuntimeDeviceRegistry` does not expose `viewProviders` and `createRuntimeDeviceRegistry` does not configure scrcpy providers.

- [ ] **Step 3: Implement the runtime wiring**

Use the configured absolute ADB path and `TEST_CENTER_SCRCPY_SERVER_PATH`, defaulting to `<projectRoot>\tools\scrcpy\3.1\scrcpy-server`. If the server file is absent, return an empty provider map and keep the existing degraded startup behavior. Otherwise construct `AdbScrcpyVideoTransport` and `TangoScrcpyViewProvider` through the coordinator factory, return the mutable map as `viewProviders`, and close the coordinator before closing the database.

- [ ] **Step 4: Pass `viewProviders` into `createApp`**

Add the map to both `main.ts` and `dev.ts`; the existing `/ws/video/:serial` gateway then sees online providers without changing its wire format.

- [ ] **Step 5: Run focused tests and typecheck**

Run `npm exec vitest run apps/server/src/runtime-video.test.ts apps/server/src/device-runtime.test.ts` and `npm run typecheck`. Expected: PASS.

### Task 3: Start providers from the authenticated video gateway

**Files:**
- Modify: `apps/server/src/ws/video-gateway.ts`
- Test: `apps/server/src/ws/video-gateway.test.ts`

- [ ] **Step 1: Write the failing gateway test**

Add a fake provider whose `start()` publishes a deterministic latest frame. Connect through the authenticated gateway handler and assert that `start()` runs before the initial frame is sent; assert that an unavailable provider still closes with code `1008`.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npm exec vitest run apps/server/src/ws/video-gateway.test.ts`.

Expected: fail because the gateway currently reads the latest frame without starting the provider.

- [ ] **Step 3: Implement start-before-subscribe**

Make the WebSocket handler await `provider.start()` after authentication and serial validation, then send the latest frame and subscribe. Keep the existing bounded JSON encoding and `1008` close behavior for authentication, provider, startup, or encoding failures.

- [ ] **Step 4: Run the focused gateway test**

Run `npm exec vitest run apps/server/src/ws/video-gateway.test.ts`. Expected: PASS.

### Task 4: Verify and document the acceptance boundary

**Files:**
- Modify: `docs/milestones/M11-acceptance.md`

- [ ] **Step 1: Run fresh verification**

Run `npm exec vitest run apps/server/src/runtime-video.test.ts apps/server/src/device-runtime.test.ts apps/server/src/ws/video-gateway.test.ts`, `npm run typecheck`, `git diff --check`, and the full Vitest suite.

- [ ] **Step 2: Update the acceptance note**

State that the portable runtime now wires the real scrcpy provider when the pinned server asset is present, while periodic Appium screenshot fallback and recorded leader-video evidence remain outside this slice.

- [ ] **Step 3: Stop for user approval**

Leave the changes local and uncommitted after verification. Present the evidence and wait for explicit approval before committing, merging to `main`, and pushing `origin/main`.
