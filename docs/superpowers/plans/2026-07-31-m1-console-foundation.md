# M1 Management Console Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure double-click Windows launcher, persistent local API/WebSocket service, idempotent SQLite foundation, and Device-Farm-inspired React console shell that survives browser refresh and clean restart.

**Architecture:** Fastify binds only to `127.0.0.1`, owns authenticated state, serves the built React console, and publishes typed snapshot/events over WebSocket. SQLite migrations and repositories live in a separate package. A self-contained .NET WinForms launcher is the sole creator of per-launch secret material, passes it to the project-local Node service through the child's one-shot stdin pipe, verifies an HMAC-authenticated readiness record, opens a fragment-carried one-time bootstrap code, and shuts down the child process tree cleanly.

**Tech Stack:** Fastify 5.11.0, `@fastify/websocket` 11.3.0, `@fastify/static` 10.1.2, `@fastify/cookie` 11.1.2, `@fastify/helmet` 13.1.0, `@fastify/cors` 11.3.0, better-sqlite3 13.0.2, React 19.2.8, Vite 8.2.0, TanStack Query 5.101.4, lucide-react 1.28.0, .NET 8 WinForms, Vitest, xUnit, and Playwright.

---

## Task 1: Add Idempotent SQLite Migrations and Runtime Paths

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/connection.ts`
- Create: `packages/database/src/migrations.ts`
- Create: `packages/database/src/migrations/0001_foundation.sql`
- Create: `packages/database/src/runtime-paths.ts`
- Create: `packages/database/src/settings-repository.ts`
- Create: `packages/database/src/database.test.ts`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/settings.ts`

- [ ] **Step 1: Write failing migration and path tests**

Tests use a temporary E-style root and require: WAL mode, foreign keys, busy timeout, migration checksum storage, two identical migration runs, rejection of a changed already-applied migration, and every mutable path below the configured `dataRoot`.

```ts
const first = migrate(db, migrations);
const second = migrate(db, migrations);
expect(first.applied).toEqual(["0001_foundation"]);
expect(second.applied).toEqual([]);
expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
```

- [ ] **Step 2: Run tests and verify the missing database package failure**

Run the database test file. Expected: FAIL with unresolved imports.

- [ ] **Step 3: Add exact foundation dependencies**

Pin React/ReactDOM `19.2.8`, Vite `8.2.0`, `@vitejs/plugin-react` `6.0.5`, Fastify `5.11.0`, websocket `11.3.0`, static `10.1.2`, cookie `11.1.2`, helmet `13.1.0`, CORS `11.3.0`, better-sqlite3 `13.0.2`, its types `7.6.13`, TanStack Query `5.101.4`, lucide-react `1.28.0`, React types `19.2.18`/`19.2.4`, jsdom `30.0.1`, and `@playwright/test` `1.62.1`. Run portable npm install and require `npm ls --all` exit 0.

- [ ] **Step 4: Implement validated runtime paths**

Export `createRuntimePaths(projectRoot)` returning absolute `dataRoot`, `databasePath`, `logsRoot`, `artifactsRoot`, `runsRoot`, and `tempRoot`. Resolve and compare with `path.relative`; reject traversal or a root on another drive. Directory creation is explicit through `ensureRuntimeDirectories()`.

- [ ] **Step 5: Implement migration transaction semantics**

Create tables `schema_migrations`, `settings`, `launcher_sessions`, and `audit_events`. Store SHA-256 for migration text. Apply each new migration in `BEGIN IMMEDIATE`; a checksum mismatch is fatal. Never auto-downgrade. Settings use a closed key/schema registry for data root, port ranges, 20/5 GiB thresholds, default pause policy, evidence defaults, and retention days; unknown keys are rejected.

- [ ] **Step 6: Run tests and commit**

```powershell
git add package.json package-lock.json packages/database packages/contracts/src/health.ts packages/contracts/src/settings.ts
git commit -m "feat: add persistent runtime foundation"
git push
```

## Task 2: Build Authenticated Fastify Health and WebSocket State

**Files:**
- Create: `packages/security/package.json`
- Create: `packages/security/tsconfig.json`
- Create: `packages/security/src/bootstrap-session.ts`
- Create: `packages/security/src/request-policy.ts`
- Create: `packages/security/src/security.test.ts`
- Create: `packages/contracts/src/launcher-ipc.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/main.ts`
- Create: `apps/server/src/routes/health.ts`
- Create: `apps/server/src/routes/bootstrap.ts`
- Create: `apps/server/src/routes/settings.ts`
- Create: `apps/server/src/launcher-ipc.ts`
- Create: `apps/server/src/ws/state-gateway.ts`
- Create: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write failing cross-site and bootstrap tests**

Use `fastify.inject()` to prove that wrong Host, DNS-rebinding Host values, missing/foreign Origin on mutating requests, missing CSRF token, reused bootstrap code, and unauthenticated WebSocket upgrade are rejected. Test the shared launcher IPC schema, bounded length-prefix decoder, one-shot pipe consumption, readiness HMAC validation, and rejection of missing/replayed launch material. Also prove a valid one-time code sets an HttpOnly SameSite=Strict cookie and disappears from storage.

```ts
const first = await app.inject({ method: "POST", url: "/api/bootstrap/exchange", payload: { code } });
expect(first.statusCode).toBe(204);
expect(first.headers["set-cookie"]).toContain("HttpOnly");
const replay = await app.inject({ method: "POST", url: "/api/bootstrap/exchange", payload: { code } });
expect(replay.statusCode).toBe(401);
```

- [ ] **Step 2: Run tests and verify failure**

Expected: FAIL because server/security modules are missing.

- [ ] **Step 3: Implement the single-owner launcher IPC contract**

Define a versioned, length-bounded `LauncherInit` contract containing launcher-generated 32-byte launch secret and separate one-time bootstrap code. The server reads exactly one length-prefixed message from child stdin before binding, requires EOF immediately afterward, stores only SHA-256 hashes with expiry in memory and `launcher_sessions`, and writes a readiness record containing actual port, PID, nonce, and HMAC to stdout. It rejects absent/replayed/late/trailing initialization and never generates competing credential material.

- [ ] **Step 4: Implement per-launch browser authentication**

The launcher later carries the bootstrap code in the URL fragment so it is not sent in HTTP request lines; console bootstrap JavaScript removes the fragment before POSTing the code once. Exchange uses constant-time comparison, creates a random opaque session ID cookie and CSRF token, then consumes the code. Do not place launch secrets or bootstrap codes in query logs, stdout, or SQLite plaintext.

- [ ] **Step 5: Implement strict request policy**

Allow only `127.0.0.1:<actualPort>` and `[::1]:<actualPort>` Host values, exact launcher console Origin, GET/HEAD/OPTIONS without CSRF, and same-origin mutation with cookie plus `X-TestCenter-CSRF`. Set CSP, `frame-ancestors 'none'`, `X-Content-Type-Options`, and `Referrer-Policy: no-referrer`. Disable permissive CORS.

- [ ] **Step 6: Implement health snapshot and replayable WebSocket**

`GET /api/health` returns a versioned `HealthSnapshot`. `/ws/state` authenticates cookie and Origin, sends a complete snapshot first, then events with monotonically increasing `eventSeq`. Reconnect accepts `afterSeq`; if history is unavailable, send a replacement snapshot instead of an incomplete delta.

- [ ] **Step 7: Add validated settings APIs**

`GET /api/settings` returns effective values plus source/default. `PATCH /api/settings` accepts only the closed schemas, CSRF, and optimistic version; validates port-range non-overlap, absolute E-drive data root containment, thresholds `danger < warning`, and retention bounds. It never edits machine environment variables.

- [ ] **Step 8: Run security/server tests and commit**

```powershell
git add packages/contracts/src/launcher-ipc.ts packages/security apps/server
git commit -m "feat: add secure local control plane"
git push
```

## Task 3: Build the Operational Console Shell

**Files:**
- Create: `apps/console/package.json`
- Create: `apps/console/tsconfig.json`
- Create: `apps/console/vite.config.ts`
- Create: `apps/console/index.html`
- Create: `apps/console/src/main.tsx`
- Create: `apps/console/src/app/App.tsx`
- Create: `apps/console/src/app/routes.tsx`
- Create: `apps/console/src/app/query-client.ts`
- Create: `apps/console/src/app/state-stream.ts`
- Create: `apps/console/src/styles/tokens.css`
- Create: `apps/console/src/styles/app.css`
- Create: `apps/console/src/components/AppShell.tsx`
- Create: `apps/console/src/components/HealthBanner.tsx`
- Create: `apps/console/src/pages/OverviewPage.tsx`
- Create: `apps/console/src/pages/DevicesPage.tsx`
- Create: `apps/console/src/pages/AppsPage.tsx`
- Create: `apps/console/src/pages/DeploymentsPage.tsx`
- Create: `apps/console/src/pages/SessionsPage.tsx`
- Create: `apps/console/src/pages/ResultsPage.tsx`
- Create: `apps/console/src/pages/SettingsPage.tsx`
- Create: `apps/console/src/app/App.test.tsx`

- [ ] **Step 1: Write failing navigation and refresh-state tests**

Render with a fake health endpoint and event stream. Assert all seven pages are reachable, active navigation is announced, health/degraded banners do not change page dimensions, disconnect state is visible, and a fresh mount reconstructs state from `GET /api/health` before deltas.

- [ ] **Step 2: Run the console test and verify missing-component failure**

Expected: FAIL with missing `App`.

- [ ] **Step 3: Implement the quiet operational shell**

Use a fixed 232 px desktop sidebar, 56 px top bar, constrained content width, and mobile diagnostic layout without marketing hero content. Navigation uses lucide icons and text: Overview, Devices, Apps, Deployments, Sessions, Results, Settings. Pages are unframed work surfaces; only repeated items and actual tools use cards with radius at most 8 px.

- [ ] **Step 4: Implement baseline Overview and Settings behavior**

Overview renders host/service/M0 health, current free space, zero-device/zero-run operational states, and recent audit events. Settings renders validated data root, port ranges, disk thresholds, default failure/evidence policy, and retention controls using inputs/steppers/selects; save shows field errors and optimistic conflict without changing global environment values.

- [ ] **Step 5: Implement resilient state hydration**

Fetch snapshot with TanStack Query, then connect WebSocket using the current CSRF/session state. Apply only increasing `eventSeq`; on gap, invalidate and refetch snapshot. Show loading, unavailable, degraded, and connected states without overlapping navigation or content.

- [ ] **Step 6: Run component tests, build, and commit**

```powershell
git add apps/console
git commit -m "feat: add management console shell"
git push
```

## Task 4: Add the Self-Contained Windows Launcher

**Files:**
- Create: `apps/launcher/TestCenter.Launcher.sln`
- Create: `apps/launcher/src/TestCenter.Launcher/TestCenter.Launcher.csproj`
- Create: `apps/launcher/src/TestCenter.Launcher/Program.cs`
- Create: `apps/launcher/src/TestCenter.Launcher/LauncherForm.cs`
- Create: `apps/launcher/src/TestCenter.Launcher/ServerProcess.cs`
- Create: `apps/launcher/src/TestCenter.Launcher/BootstrapClient.cs`
- Create: `apps/launcher/tests/TestCenter.Launcher.Tests/TestCenter.Launcher.Tests.csproj`
- Create: `apps/launcher/tests/TestCenter.Launcher.Tests/ServerProcessTests.cs`
- Create: `apps/launcher/tests/TestCenter.Launcher.Tests/LauncherIpcTests.cs`
- Create: `scripts/build-launcher.ps1`

- [ ] **Step 1: Write failing process-supervision tests**

Use a fixture child process. Assert explicit project-local Node path/environment, hidden child window, stdout/stderr ring buffers, one-shot child-stdin initialization and closure, authenticated readiness timeout, bootstrap fragment construction, graceful `/api/shutdown` then process-tree kill fallback, and no browser open before readiness/HMAC verification.

- [ ] **Step 2: Run `dotnet test` and verify failure before implementation**

Expected: compile failure because `ServerProcess` is missing.

- [ ] **Step 3: Implement launcher lifecycle**

The form displays service state, bound address, M0 summary, log tail, Start, Stop, Open Console, and Export Diagnostics. Start creates the launch secret and bootstrap code in memory, launches `tools\node\22.23.1\node.exe apps\server\dist\main.js` with redirected stdin/stdout/stderr, writes one versioned initialization message to child stdin and closes it, verifies the readiness-record HMAC for the requested/actual loopback port, then opens `http://127.0.0.1:<port>/bootstrap#code=<encoded-code>`. Buttons have fixed dimensions and icon/tooltips.

- [ ] **Step 4: Publish self-contained win-x64 output**

`scripts/build-launcher.ps1` runs `dotnet publish` for `net8.0-windows`, `win-x64`, self-contained, single-file, Release, into `dist\launcher`. It does not embed Node or data yet; M11 assembles the portable directory.

- [ ] **Step 5: Run launcher tests and commit**

```powershell
dotnet test .\apps\launcher\TestCenter.Launcher.sln --configuration Release
git add apps/launcher scripts/build-launcher.ps1
git commit -m "feat: add Windows service launcher"
git push
```

## Task 5: Verify End-to-End Start, Refresh, Restart, and Security

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/foundation.spec.ts`
- Create: `tests/e2e/security.spec.ts`
- Create: `scripts/run-dev.ps1`
- Create: `scripts/provision-playwright.ps1`
- Create: `docs/milestones/M1-acceptance.md`

- [ ] **Step 1: Write failing Playwright flows**

Cover launcher-assisted bootstrap, all navigation pages, browser refresh, service restart, WebSocket resnapshot, invalid/reused bootstrap code, foreign Origin/Host/CSRF rejection, stable 1440x900 and 1024x768 layouts, and clean shutdown.

- [ ] **Step 2: Run Playwright and verify it fails before the harness exists**

Expected: FAIL because `webServer`/launcher fixture is missing.

- [ ] **Step 3: Provision project-local Chromium deterministically**

`scripts/provision-playwright.ps1` sets `PLAYWRIGHT_BROWSERS_PATH` to `data\tools\ms-playwright`, runs the pinned project-local Playwright CLI with `install chromium`, records the resolved browser revision/path, and reruns idempotently without using a global cache. A missing or wrong revision fails before E2E execution.

- [ ] **Step 4: Implement the E2E harness with isolated data roots**

Every test run receives a temporary `TEST_CENTER_DATA_ROOT`, random loopback port, and deterministic fake environment diagnostic. The harness kills only its recorded child PID tree and preserves failure traces/screenshots under `test-results`.

- [ ] **Step 5: Run full fresh verification**

Run the provisioning script, Vitest, TypeScript build, ESLint, Prettier check, `dotnet test`, console production build, and Playwright with the same project-local browser path. Expected: zero failures. Capture desktop screenshots for Overview and each page shell.

- [ ] **Step 6: Record acceptance and stop**

Write `docs/milestones/M1-acceptance.md` with commands, screenshots, restart timing, security cases, known limitations, and rollback. Commit and push:

```powershell
git add playwright.config.ts tests/e2e scripts/run-dev.ps1 scripts/provision-playwright.ps1 docs/milestones/M1-acceptance.md
git commit -m "test: verify M1 console foundation"
git push
git status --short --branch
```

Expected: clean `codex/m1-console-foundation` branch. Stop for explicit user acceptance; do not begin device discovery.
