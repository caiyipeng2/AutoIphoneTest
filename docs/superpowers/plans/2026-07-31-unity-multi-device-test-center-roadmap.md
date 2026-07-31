# Unity Multi-Device Test Center Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a portable Windows test center that lets one tester operate a leader view and safely reproduce traceable actions across a dynamically selected group of 1-4 local Android devices.

**Architecture:** A local Fastify/TypeScript control plane owns SQLite state, device workers, transactional action dispatch, evidence, and reports. A React console is the operational surface, a self-contained .NET Windows launcher owns lifecycle/auth bootstrap, Appium/UiAutomator2 injects device actions, and a QA-only Unity package reports identity, geometry, state, focus, and correlated receipts. All serial-specific resources are isolated behind typed adapters and all large mutable data remains under `E:\Projects\UnityMultiDeviceTestCenter\data`.

**Tech Stack:** Node.js 22.23.1, npm workspaces, TypeScript 6.0.3, React 19.2.8, Vite 8.2.0, Fastify 5.11.0, Zod 4.4.3, better-sqlite3 13.0.2, Appium 3.6.0, UiAutomator2 8.2.2, Tango ADB/scrcpy adapter, scrcpy server 3.1, Eclipse Temurin JDK 17.0.19+10, bundletool 1.18.3, .NET 8 self-contained WinForms launcher, Unity 2022.3.62f2, Vitest 4.1.10, and Playwright 1.62.1.

---

## 1. Repository and Approval Contract

- Local root: `E:\Projects\UnityMultiDeviceTestCenter`.
- Remote: `https://github.com/caiyipeng2/AutoIphoneTest.git`.
- Accepted design: `docs/superpowers/specs/2026-07-31-unity-multi-device-test-center-design.md`.
- Detailed plans: `docs/superpowers/plans/2026-07-31-m0-*.md` through `2026-07-31-m11-*.md`.
- M0-M11 execute strictly in order. A later milestone may not absorb an unfinished acceptance item from an earlier milestone.
- Each milestone uses a `codex/mN-<name>` branch created in an E-drive worktree. Implementation commits are pushed to that branch for review.
- After fresh automated and applicable real-device evidence is reported, work stops. Only explicit user acceptance permits merging/pushing that milestone to `origin/main` and creating the next milestone branch.
- Physical gates cannot be simulated away: M7 needs two real devices and M8 needs all 1/2/3/4 combinations plus a four-device soak.

### Milestone branch/worktree bootstrap

The reviewed design and plans are committed to `origin/main` before execution. After the user explicitly authorizes a milestone, create its branch/worktree with the following clean-state gate; substitute only the approved milestone name. If the branch or worktree already exists, stop and inspect/reuse it instead of deleting or recreating it.

```powershell
$repoRoot = 'E:\Projects\UnityMultiDeviceTestCenter'
$milestoneName = 'm0-environment-self-check'
$branchName = 'codex/' + $milestoneName
$worktreePath = 'E:\Projects\UnityMultiDeviceTestCenter-worktrees\' + $milestoneName

Set-Location -LiteralPath $repoRoot
git fetch origin
if (git status --porcelain) { throw 'Main worktree must be clean before milestone bootstrap.' }
git switch main
git pull --ff-only origin main
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $worktreePath) | Out-Null
git worktree add $worktreePath -b $branchName origin/main
git -C $worktreePath push -u origin $branchName
git -C $worktreePath status --short --branch
```

Expected for M0: `## codex/m0-environment-self-check...origin/codex/m0-environment-self-check` with no changed files. This makes every later plain `git push` target the milestone branch, never `origin/main`. The same checked sequence is repeated only after prior milestone acceptance/merge, using the next approved milestone name.

After the user explicitly accepts that milestone, and only then, fast-forward the checked branch into main and publish it:

```powershell
Set-Location -LiteralPath $repoRoot
git fetch origin
git switch main
git pull --ff-only origin main
git merge --ff-only $branchName
git push origin main
git status --short --branch
```

Expected: clean `main...origin/main` at the accepted milestone commit. Keep the E-drive worktree until that remote equality is verified; cleanup is a separate, explicit maintenance action.

## 2. Locked Version Policy

`tools/tool-manifest.json` is the authoritative external-tool manifest. `package-lock.json` is the authoritative JavaScript dependency lock. M0 records download URL, archive SHA-256, executable relative path, version command, and license source for every portable tool.

| Tool | Pinned version | Reason |
|---|---:|---|
| Node.js win-x64 ZIP | 22.23.1 | Current Node 22 LTS line and compatible with Appium/Vite requirements |
| npm | Bundled with Node 22.23.1 | No global npm dependency |
| Appium | 3.6.0 | Current registry release; bound to loopback without relaxed security |
| UiAutomator2 driver | 8.2.2 | Current release with Appium 3 peer compatibility |
| Eclipse Temurin JDK win-x64 | 17.0.19+10 | Project-local bundletool/jarsigner runtime, separate from Unity's embedded JDK |
| bundletool | 1.18.3 | Current official release for AAB conversion |
| scrcpy server/client bundle | 3.1 | Stable Tango 2.x protocol support; version 4.x remains behind `ViewProvider` until its adapter is proven |
| .NET target | net8.0-windows | LTS, self-contained final launcher |
| Local build SDK | 9.0.304 | Verified installed SDK; `global.json` pins it for launcher builds |
| Unity | 2022.3.62f2 | Verified local editor and Android toolchain |

No task uses `latest`, an unversioned download URL, a global npm package, bare `java`, or an implicit `adb` target.

## 3. Planned Repository Map

```text
E:\Projects\UnityMultiDeviceTestCenter\
  apps\
    server\                    Fastify API, WebSocket gateway, process lifecycle
    console\                   React operational UI and leader input overlay
    launcher\                  WinForms launcher and process supervisor
    credential-helper\         Windows Credential Manager helper with stdin/stdout redaction
  packages\
    contracts\                 Zod schemas and shared TypeScript types
    environment\               M0 tool resolution and diagnostic report
    database\                  SQLite connection, migrations, transactions
    security\                  bootstrap session, CSRF, Host/Origin/CORS policy
    adb\                       typed serial-bound ADB command adapter
    appium\                    Appium service/session/port adapters
    devices\                   inventory, health, installation and UID state
    artifacts\                 immutable package and installed-version identities
    deployments\               APK/AAB conversion, signing and installation workflows
    bridge\                    QA protocol parser, clock calibration and ADB-forward client
    video\                     ViewProvider and scrcpy/MJPEG implementations
    sessions\                  run membership, action outbox, workers and failure policy
    evidence\                  atomic captures, redaction, retention and integrity
    reports\                   HTML/ZIP and optional Excel/PDF/JUnit exporters
    build-provider\            ArtifactImportProvider and future BuildProvider contract
    unity-qa-bridge\           UPM package and minimal Unity verification project
  tests\
    fixtures\                  recorded ADB/Appium/bridge/artifact inputs
    integration\               SQLite, service, process and crash-recovery tests
    e2e\                       Playwright workflows and security cases
    hardware\                  opt-in real-device and soak runners
  scripts\                     E-drive bootstrap, verification and packaging entrypoints
  tools\tool-manifest.json     pinned external runtime metadata
  data\                        ignored mutable DB, artifacts, runs, logs and reports
```

## 4. Shared Contract Names

These names and ownership boundaries are fixed across all milestone plans. A milestone may extend a discriminated union or schema only when its own plan says so.

```ts
export type DeviceSerial = string & { readonly __brand: "DeviceSerial" };
export type RunId = string & { readonly __brand: "RunId" };
export type ActionId = string & { readonly __brand: "ActionId" };
export type ClientRequestId = string & { readonly __brand: "ClientRequestId" };

export interface ProcessSpec {
  executableId: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  serial?: DeviceSerial;
  redactArgIndexes?: readonly number[];
}

export interface RunMembershipSnapshot {
  runId: RunId;
  membershipEpoch: number;
  leaderSerial: DeviceSerial;
  targets: readonly {
    serial: DeviceSerial;
    role: "LEADER" | "FOLLOWER";
    workerGeneration: number;
  }[];
}

export interface ActionEnvelope {
  runId: RunId;
  actionId: ActionId;
  clientRequestId: ClientRequestId;
  actionSeq: number;
  parentActionId: ActionId | null;
  membership: RunMembershipSnapshot;
  sourceFrameId: string;
  sourceMetricsEpoch: number;
  hostMonotonicTimeNs: bigint;
  command: ActionCommand;
}

export interface EncodedFrame {
  frameId: string;
  deviceSerial: DeviceSerial;
  capturedAtDeviceNs?: bigint;
  receivedAtHostNs: bigint;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  codec: "h264" | "h265" | "av1" | "jpeg";
  metricsEpoch: number;
  bytes: Uint8Array;
}

export interface ViewProvider {
  start(serial: DeviceSerial, profile: ViewProfile): AsyncIterable<EncodedFrame>;
  setProfile(profile: ViewProfile): Promise<void>;
  stop(): Promise<void>;
}

export interface BuildProvider {
  readonly id: string;
  validate(request: BuildRequest): Promise<BuildValidation>;
  build(request: BuildRequest, events: BuildEventSink): Promise<AppArtifactRef>;
  cancel(buildId: string): Promise<void>;
}
```

The complete discriminated unions are introduced by the milestone that first executes them; later plans must import rather than redefine them.

## 5. Milestone Dependency and Stop Matrix

| Milestone | Depends on | Working result delivered | Required stop evidence |
|---|---|---|---|
| M0 | Approved plans | Reproducible E-drive bootstrap and environment self-check JSON/HTML | Unit tests plus live machine diagnostic |
| M1 | M0 accepted | Secure launcher, API/WebSocket, SQLite and visual console shell | Start/stop/restart, security tests, Playwright screenshots |
| M2 | M1 accepted | One-device inventory and reconnect lifecycle | Current Samsung metadata and unplug/replug timeline |
| M3 | M2 accepted | Immutable APK/AAB/installed-version library | Fixture hashes, invalid import rollback, Apps page |
| M4 | M3 accepted | One-device APK/AAB deployment and generation-aware UID invalidation | Real install/launch/version/signature evidence |
| M5 | M4 accepted | QA-only Unity bridge, UID/focus/metrics and safe arm/ACK contract | Fixture build, real `QA_STATE`, release-negative test |
| M6 | M5 accepted | Leader view and crash-safe single-device action run | Stream metrics, idempotency/crash test, evidence manifest |
| M7 | M6 accepted | One leader plus one follower synchronized tap/swipe | Two-device accuracy/skew and fenced-rejoin report |
| M8 | M7 accepted | Dynamic 1-4 membership/deployment and four-device isolation | Capacity matrix and 30-minute/1,000-action soak |
| M9 | M8 accepted | Full first-version actions and failure policies | Action/fault matrix, no-auto-replay proof |
| M10 | M9 accepted | History, offline HTML, atomic evidence ZIP and interrupted report | Normal/failure/interrupted fixtures and crash-finalization tests |
| M11 | M10 accepted | Optional exports and portable Windows release | Clean extraction real-device smoke plus 60-minute stability |

## 6. Per-Milestone Verification Command Contract

Every detailed plan ends with fresh executions of the applicable commands and records their full exit status:

```powershell
.\tools\node\22.23.1\node.exe .\node_modules\vitest\vitest.mjs run
.\tools\node\22.23.1\node.exe .\node_modules\typescript\bin\tsc --build --pretty false
.\tools\node\22.23.1\node.exe .\node_modules\eslint\bin\eslint.js .
.\tools\node\22.23.1\node.exe .\node_modules\@playwright\test\cli.js test
dotnet test .\apps\launcher\TestCenter.Launcher.sln --configuration Release
git diff --check
git status --short --branch
```

Hardware commands are opt-in and must always include explicit serials or a checked run manifest. A fake-adapter pass is not reported as a physical milestone pass.

## 7. Execution Handoff

After this roadmap and all M0-M11 detailed plans are approved, execution begins with M0 only. The recommended mode is subagent-driven development with a fresh implementation worker plus independent spec and quality review for each task. No command from M1 or later is executed until the previous milestone has been accepted and merged to `origin/main`.
