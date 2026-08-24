# M11 Optional exports and portable delivery acceptance

Date: 2026-08-21
Repository: `E:\Projects\UnityMultiDeviceTestCenter`
Package under test: `com.hg.idleweaponshoptycoon.android`
Remote: `https://github.com/caiyipeng2/AutoIphoneTest.git`

## Scope

M11 Task 5 validates the portable Windows delivery from a clean E-drive extraction, a real two-device Appium-only run, selectable report exports, and a 60-minute stability window. The source tree is not used as the product runtime during the hardware runs.

## Portable delivery evidence

| Check                     | Result                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| Release ZIP               | `dist/releases/TestCenterLauncher.zip`, 645,525,185 bytes                  |
| Release ZIP SHA-256       | `5dffeedc9ccbee1b9e2eade8ad08ee2457f4c230f559daa780c9e5e21c221401`         |
| Clean extraction          | `E:\M11-Portable-Verify-20260821`                                          |
| Clean manifest SHA-256    | `b5e5b19bda757570e812b452dd7215e8392f7378620657c7f4cce185d5785c92`         |
| Manifest verifier         | PASS, 41,254 files, bundled Node `v22.23.1`                                |
| Runtime paths             | Portable Node and `apps\server\dist\main.js` from the clean extraction     |
| Unicode path verification | PASS after `verify-portable.ps1` switched manifest reads to explicit UTF-8 |

The first verifier rerun exposed a PowerShell code-page bug on the third-party fixture `snow ☃/index.html`; Node confirmed the file and hash existed. The verifier now reads the UTF-8 manifest explicitly and passes the complete hash walk.

## Real clean-extraction flow

Evidence: `data/hardware-m11-portable-smoke/m11-portable-smoke.json`
Session: `run-53660a74-581d-4216-be4c-94ac0f1c5f4f`
Devices: `R5CX211TXNT` (leader), `t4vswkqcs4uc8pob` (follower)
Artifact: installed fixture verified with ADB
Package: `com.hg.idleweaponshoptycoon.android`

| Phase                    | Result                                                  |
| ------------------------ | ------------------------------------------------------- |
| Device discovery         | PASS, both devices ONLINE                               |
| Session lifecycle        | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`           |
| Tap                      | PASS on both target devices                             |
| Swipe                    | PASS on both target devices                             |
| Mandatory HTML/ZIP       | READY and downloaded with matching hashes               |
| Optional Excel/PDF/JUnit | READY, downloaded, hashed, and parse/open checks passed |

| Output    |    Size | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,566 | `a9c851efb886b0b6a430fdb6b73de072067932265d271368fb1107a851a24b8c` |
| ZIP       |   2,716 | `8f73984c3f938403ad4e2d6c91278426b369b1cc8f2f123ac8551739a00526d6` |
| Excel     |  10,604 | `db732fdebb3e1ca54dc8531d19b291dea37ab8e4b404db52fcac324db8bfb920` |
| PDF       | 125,512 | `926cdaa535a06ef96c32f95be6a41f1fb3cfc15d125a2239296ae03b90e7e00b` |
| JUnit XML |   1,871 | `16e7611f24d9ec0ce34cba131c9d74378d589941f2cc0c96bf75c3e88fb04f12` |

## Stability evidence

Evidence: `data/hardware-m11-stability/m11-stability.json`
Full process log: `data/hardware-m11-stability/m11-stability-full.log`
Session: `run-ce885aab-955b-4846-8af5-5c16422714e2`

| Metric              | Result                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Duration / sampling | 3,600 seconds / 10 seconds                                                                               |
| Checkpoint interval | 30 seconds; all checkpoint actions succeeded                                                             |
| Warmup discarded    | First 600 seconds                                                                                        |
| Analyzed samples    | 275 post-warmup samples; analyzer `m11-stability-analyzer-v2`                                            |
| Session/report      | `FINISHED`, finalization `COMPLETED`, HTML and ZIP `READY`                                               |
| Crashes/restarts    | 0 / 0                                                                                                    |
| Queue               | Maximum depth 0; sustained violation 0 seconds                                                           |
| WAL                 | Maximum 4,206,552 bytes, below 64 MiB                                                                    |
| Private bytes       | Theil-Sen slope `18198.583387` bytes/minute; Kendall tau `0.059137`; final rolling delta `-0.091797 MiB` |
| Handles             | Slope 0/minute; final delta 0                                                                            |
| Threads             | Slope 0/minute; final delta -5                                                                           |
| Device temperature  | 38-39 C samples                                                                                          |
| Cleanup snapshot    | worker 0, port lease 0, forward 0                                                                        |

The analyzer uses the fixed thresholds in `docs/superpowers/plans/2026-07-31-m11-exports-portable-delivery.md`; no threshold was changed after viewing samples. The earlier failed 60-minute attempt was retained as diagnostic evidence: its action failures began after the 60-second Appium `newCommandTimeout` boundary. The stability runner now sends a safe checkpoint every 30 seconds, and a 95-second two-device preflight confirmed the fix before the passing 60-minute run.

## Automated verification

| Check                      | Result                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Full Vitest suite          | PASS, 142 files, 550 tests; 1 file and 2 tests skipped by existing suite configuration |
| M11 analyzer tests         | PASS, 5 tests                                                                          |
| TypeScript build           | PASS, `npm run typecheck`                                                              |
| New M11 files ESLint       | PASS                                                                                   |
| New M11 files Prettier     | PASS                                                                                   |
| Portable manifest verifier | PASS, 41,254 files                                                                     |

Repository-wide ESLint/Prettier commands still report pre-existing findings in generated Unity `Library/Bee` files and unrelated legacy scripts; those files were not changed by this slice.

## Known limitations and acceptance boundary

- The current server assembly persists `leaderVideoEnabled`, and managed workers capture logcat, but the portable `main.ts` path does not yet wire a real scrcpy/video provider or periodic screenshot publisher into the runtime context. The 60-minute result therefore proves Appium actions, logcat/resource stability, report finalization, and cleanup; it does not claim a recorded leader-video artifact.
- The Unity command build provider remains intentionally unimplemented; use an imported APK/AAB or an installed fixture.
- Fault injection and active-session recovery acceptance remain skipped per prior user confirmation.

## M0-M11 traceability

Prior milestone records remain the source of truth: [M0](M0-acceptance.md), [M1](M1-acceptance.md), [M2](M2-acceptance.md), [M3](M3-acceptance.md), [M5](M5-acceptance.md), [M6](M6-task1-acceptance.md), [M7](M7-console-session-ui-acceptance.md), [M8](M8-device-worker-managed-lifecycle-acceptance.md), [M9](M9-acceptance.md), [M10](M10-acceptance.md), [M11 Task 1](M11-task1-excel-acceptance.md), [M11 Task 2a](M11-task2a-junit-acceptance.md), [M11 Task 2b](M11-task2b-pdf-acceptance.md), [M11 Task 3a](M11-task3a-export-queue-acceptance.md), [M11 Task 3b](M11-task3b-results-export-acceptance.md), and [M11 Task 4](M11-task4-portable-acceptance.md).

## Decision

**M11 portable delivery, clean real-device flow, optional exports, stability analyzer, and 60-minute Appium-only two-device run: PASS locally. Leader-video/screenshot capture remains a documented limitation.**

All source changes are intentionally uncommitted and unpushed pending explicit user approval. Do not merge, tag, create a GitHub Release, or delete the clean extraction before final acceptance.
