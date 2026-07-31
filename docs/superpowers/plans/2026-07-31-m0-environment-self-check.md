# M0 Environment Self-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the reproducible E-drive workspace and produce a tested JSON/HTML diagnostic that reports the real Windows, Android, Unity, tool, port, and storage state without modifying global settings.

**Architecture:** A hash-verifying PowerShell bootstrap installs only portable Node into `tools/`; a small TypeScript environment package runs typed, timeout-bounded probes using explicit executable paths. The M0 CLI writes immutable diagnostic JSON plus a static HTML view under ignored `data/diagnostics`, and returns distinct healthy/degraded/fatal exit codes.

**Tech Stack:** PowerShell 7, Node.js 22.23.1 portable, npm workspaces, TypeScript 6.0.3, Zod 4.4.3, Vitest 4.1.10, ESLint 10.8.0, and Prettier 3.9.6.

---

## Task 1: Add Repository Policy and the Portable Node Bootstrap

**Files:**
- Modify: `.gitignore`
- Create: `.gitattributes`
- Create: `.editorconfig`
- Create: `global.json`
- Create: `tools/tool-manifest.json`
- Create: `scripts/bootstrap-node.ps1`
- Create: `tests/bootstrap/bootstrap-node.tests.ps1`

- [ ] **Step 1: Write a failing bootstrap contract test**

Create `tests/bootstrap/bootstrap-node.tests.ps1` with an isolated temporary directory, a deliberately wrong SHA-256 manifest, and assertions that the bootstrap exits nonzero without publishing a runtime directory:

```powershell
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('test-center-bootstrap-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $sandbox | Out-Null
try {
    $manifest = Join-Path $sandbox 'tool-manifest.json'
    @{
        schemaVersion = 1
        tools = @{
            node = @{
                version = '22.23.1'
                url = 'https://example.invalid/node.zip'
                sha256 = ('0' * 64)
                archiveRoot = 'node-v22.23.1-win-x64'
                executable = 'node.exe'
            }
        }
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifest -Encoding utf8

    & (Join-Path $repo 'scripts\bootstrap-node.ps1') -ManifestPath $manifest -ToolsRoot (Join-Path $sandbox 'tools') -ArchivePath (Join-Path $repo 'tests\fixtures\not-a-node.zip')
    if ($LASTEXITCODE -eq 0) { throw 'Expected invalid archive/hash to fail.' }
    if (Test-Path (Join-Path $sandbox 'tools\node\22.23.1')) { throw 'Failed bootstrap published a runtime directory.' }
} finally {
    Remove-Item -LiteralPath $sandbox -Recurse -Force
}
```

- [ ] **Step 2: Run the bootstrap test and verify the missing script failure**

Run: `pwsh -NoProfile -File .\tests\bootstrap\bootstrap-node.tests.ps1`

Expected: FAIL because `scripts\bootstrap-node.ps1` does not exist.

- [ ] **Step 3: Add repository text and generated-data policy**

Use `.gitattributes` to keep source LF-stable and Windows launchers CRLF-stable:

```gitattributes
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.json text eol=lf
*.md text eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
*.cs text eol=crlf
*.csproj text eol=crlf
```

Remove the obsolete `apps/` ignore entry, keep `data/` ignored, ignore `tools/*` while explicitly allowing tracked `tools/tool-manifest.json`, and add `TestResults/`, `playwright-report/`, and `*.trx`.

- [ ] **Step 4: Add the exact external-tool manifest**

Create `tools/tool-manifest.json` with schema version `1` and entries for Node `22.23.1`, Eclipse Temurin JDK `17.0.19+10`, bundletool `1.18.3`, scrcpy `3.1`, Appium `3.6.0`, and UiAutomator2 `8.2.2`. Each archive entry contains the official HTTPS URL, verified SHA-256 copied from the vendor checksum/release asset, archive root, executable path, version arguments, and license URL. npm tools use exact package/version fields and have no download URL.

- [ ] **Step 5: Implement hash-first atomic Node provisioning**

Implement `scripts/bootstrap-node.ps1` with parameters `ManifestPath`, `ToolsRoot`, and optional `ArchivePath`. It must download to `tools\.downloads\*.partial`, compare uppercase SHA-256 with the manifest using `Get-FileHash`, expand into a sibling temporary directory, run `node.exe --version`, and rename to `tools\node\22.23.1` only after all checks pass. It must never change PATH, `JAVA_HOME`, `ANDROID_HOME`, npm global prefix, or registry values.

- [ ] **Step 6: Run both bootstrap paths**

Run the invalid-hash test again. Expected: PASS with no published directory.

Run: `pwsh -NoProfile -File .\scripts\bootstrap-node.ps1`

Expected: `tools\node\22.23.1\node.exe` exists and prints `v22.23.1`; the downloaded archive hash equals the manifest.

- [ ] **Step 7: Commit and push the bootstrap slice**

```powershell
git add .gitignore .gitattributes .editorconfig global.json tools/tool-manifest.json scripts/bootstrap-node.ps1 tests/bootstrap/bootstrap-node.tests.ps1
git commit -m "build: add portable tool bootstrap"
git push -u origin codex/m0-environment-self-check
```

## Task 2: Establish the TypeScript Workspace and Environment Contracts

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `vitest.workspace.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/environment.ts`
- Create: `packages/contracts/src/environment.test.ts`

- [ ] **Step 1: Write the failing diagnostic schema test**

Define tests that require `EnvironmentDiagnosticSchema` to accept explicit `HEALTHY`, `DEGRADED`, and `FATAL` records, reject unknown severity values, require absolute resolved paths, and preserve probe duration/error categories.

```ts
import { describe, expect, it } from "vitest";
import { EnvironmentDiagnosticSchema } from "./environment.js";

describe("EnvironmentDiagnosticSchema", () => {
  it("rejects a relative executable path", () => {
    expect(() => EnvironmentDiagnosticSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-07-31T00:00:00.000Z",
      overall: "DEGRADED",
      probes: [{ id: "adb", severity: "DEGRADED", durationMs: 4, resolvedPath: "adb.exe", facts: {}, errors: [] }],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `.\tools\node\22.23.1\node.exe .\node_modules\vitest\vitest.mjs run packages/contracts/src/environment.test.ts`

Expected: FAIL because the workspace and schema do not exist.

- [ ] **Step 3: Add exact workspace dependencies**

Create a private npm-workspace root with `apps/*` and `packages/*`. Pin TypeScript `6.0.3`, Zod `4.4.3`, Vitest `4.1.10`, ESLint `10.8.0`, `@eslint/js` `10.0.1`, `typescript-eslint` `8.65.0`, Prettier `3.9.6`, `tsx` `4.23.1`, and `@types/node` `22.20.1`. Use the portable npm:

```powershell
& .\tools\node\22.23.1\npm.cmd install --save-exact
```

Expected: `package-lock.json` is created with lockfile version 3 and `npm ls --all` exits 0.

- [ ] **Step 4: Implement the versioned Zod contracts**

Create discriminated probe/result schemas with these exported names: `ProbeSeveritySchema`, `ProbeErrorSchema`, `ProbeResultSchema`, `EnvironmentDiagnosticSchema`, `ProbeSeverity`, `ProbeResult`, and `EnvironmentDiagnostic`. Absolute Windows paths must pass `path.win32.isAbsolute`; optional paths are absent rather than empty strings.

- [ ] **Step 5: Run schema tests, typecheck, lint, and format checks**

Run the targeted Vitest command. Expected: PASS.

Run: `.\tools\node\22.23.1\node.exe .\node_modules\typescript\bin\tsc --build --pretty false`

Expected: exit 0.

- [ ] **Step 6: Commit and push the workspace slice**

```powershell
git add package.json package-lock.json tsconfig.base.json tsconfig.json eslint.config.mjs .prettierrc.json vitest.workspace.ts packages/contracts
git commit -m "build: establish typed workspace"
git push
```

## Task 3: Implement Timeout-Bounded Process and Tool Resolution

**Files:**
- Create: `packages/environment/package.json`
- Create: `packages/environment/tsconfig.json`
- Create: `packages/environment/src/process-runner.ts`
- Create: `packages/environment/src/process-runner.test.ts`
- Create: `packages/environment/src/tool-resolver.ts`
- Create: `packages/environment/src/tool-resolver.test.ts`
- Create: `tests/fixtures/environment/fake-tool.cmd`

- [ ] **Step 1: Write failing process-isolation tests**

Tests must prove that `ProcessRunner.run(spec)` uses an argument array, captures stdout/stderr separately, enforces timeout with process-tree termination, redacts configured argument indexes, and refuses a serial-required command without `serial`.

```ts
await expect(runner.run({
  executableId: "adb",
  args: ["shell", "getprop"],
  cwd,
  env: {},
  timeoutMs: 1000,
})).rejects.toMatchObject({ code: "SERIAL_REQUIRED" });
```

- [ ] **Step 2: Verify the tests fail before implementation**

Run: `.\tools\node\22.23.1\node.exe .\node_modules\vitest\vitest.mjs run packages/environment/src/process-runner.test.ts packages/environment/src/tool-resolver.test.ts`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement `ProcessRunner` without shell interpolation**

Use `spawn(executable, args, { shell: false, windowsHide: true })`; cap stdout/stderr at 1 MiB per stream; return `exitCode`, `signal`, `timedOut`, `durationMs`, and redacted command metadata. On timeout call `taskkill.exe /PID <pid> /T /F` through a separately typed host-process spec, then await exit.

- [ ] **Step 4: Implement deterministic tool resolution**

`ToolResolver` resolves in this order: explicit settings, project-local `tools/`, verified Unity embedded paths, then PATH for diagnostic-only discovery. It returns every candidate plus the selected path/reason. Runtime consumers may use only explicit/project-local/verified-Unity selections.

- [ ] **Step 5: Run tests and commit**

Expected: all environment package tests pass, TypeScript build exits 0, and no test command invokes a shell string.

```powershell
git add packages/environment tests/fixtures/environment
git commit -m "feat: add safe environment process runner"
git push
```

## Task 4: Add Real Environment Probes and Deterministic Severity

**Files:**
- Create: `packages/environment/src/probes/drive-probe.ts`
- Create: `packages/environment/src/probes/adb-probe.ts`
- Create: `packages/environment/src/probes/java-probe.ts`
- Create: `packages/environment/src/probes/node-probe.ts`
- Create: `packages/environment/src/probes/appium-probe.ts`
- Create: `packages/environment/src/probes/unity-probe.ts`
- Create: `packages/environment/src/probes/port-probe.ts`
- Create: `packages/environment/src/probes/probes.test.ts`
- Create: `packages/environment/src/run-diagnostic.ts`

- [ ] **Step 1: Write table-driven failing probe tests**

Use fake process/file/port adapters. Cover: E drive absent/fewer than 5 GiB/fewer than 20 GiB/healthy; ADB absent/no device/unauthorized/one online device; Java path/version split; Appium missing; UiAutomator2 missing; a required port occupied; and Unity 2022 Android modules present.

- [ ] **Step 2: Verify every probe test fails before implementation**

Run the probe test file. Expected: FAIL with missing probe factories.

- [ ] **Step 3: Implement probes as pure classification plus injected I/O**

Every probe exports `collect(): Promise<ProbeResult>` and keeps severity classification in a pure function. Missing Appium/UiAutomator2 is `DEGRADED` in M0, not `FATAL`; E drive below 5 GiB, unusable Node runtime, or an unwritable data root is `FATAL`. Record resolved path, version, facts, duration, and categorized errors.

- [ ] **Step 4: Implement aggregate severity**

`runEnvironmentDiagnostic()` runs independent probes concurrently, sorts results by stable probe ID, calculates `FATAL > DEGRADED > HEALTHY`, and never drops a failed probe. The generated timestamp is injected in tests.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/environment/src/probes packages/environment/src/run-diagnostic.ts
git commit -m "feat: add environment health probes"
git push
```

## Task 5: Produce Atomic JSON/HTML Diagnostics and Live Evidence

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/cli/self-check.ts`
- Create: `packages/environment/src/render-html.ts`
- Create: `packages/environment/src/publish-diagnostic.ts`
- Create: `packages/environment/src/publish-diagnostic.test.ts`
- Create: `scripts/run-self-check.cmd`
- Create: `docs/milestones/M0-acceptance.md`

- [ ] **Step 1: Write failing atomic-publication tests**

Test that a simulated write failure leaves no final JSON/HTML; a successful write creates hashed files through sibling `.partial` names and atomic rename; HTML escapes tool output; exit codes are `0` healthy, `2` degraded, and `3` fatal.

- [ ] **Step 2: Verify the tests fail before implementation**

Run the targeted publication test. Expected: FAIL with missing publisher.

- [ ] **Step 3: Implement the CLI and static diagnostic page**

The CLI accepts only `--output <absolute-directory>` and `--open`; defaults to `<repo>\data\diagnostics\<UTC timestamp>`. The HTML contains the overall status, stable probe table, device list, exact resolved paths/versions, remediation text, and JSON hash. It contains no arbitrary command buttons.

- [ ] **Step 4: Run the complete automated M0 suite**

```powershell
.\tools\node\22.23.1\node.exe .\node_modules\vitest\vitest.mjs run
.\tools\node\22.23.1\node.exe .\node_modules\typescript\bin\tsc --build --pretty false
.\tools\node\22.23.1\node.exe .\node_modules\eslint\bin\eslint.js .
.\tools\node\22.23.1\node.exe .\node_modules\prettier\bin\prettier.cjs --check .
```

Expected: all commands exit 0.

- [ ] **Step 5: Run the self-check twice on the live machine**

Run: `.\scripts\run-self-check.cmd`

Expected current baseline: E drive healthy; Unity 2022.3.62f2, Android SDK/ADB, Java paths, and the connected Samsung are recorded; Appium and UiAutomator2 are accurately `DEGRADED` if still absent; both runs classify identically except timestamps/durations.

- [ ] **Step 6: Record acceptance evidence without committing generated data**

Write `docs/milestones/M0-acceptance.md` with commands, exit codes, diagnostic SHA-256, resolved tool paths, known limitations, and rollback (`git revert` of M0 commits plus deletion of ignored `tools/` and `data/diagnostics/`). Do not commit the generated diagnostics if they contain machine-specific paths; attach them through the user-visible evidence handoff.

- [ ] **Step 7: Commit, push, and stop for user acceptance**

```powershell
git add apps/server packages/environment scripts/run-self-check.cmd docs/milestones/M0-acceptance.md
git commit -m "feat: deliver M0 environment self-check"
git push
git status --short --branch
```

Expected: branch is clean and tracks `origin/codex/m0-environment-self-check`. Stop. Do not merge to `main` and do not begin M1 until the user explicitly accepts M0.
