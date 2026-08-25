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
| Full Vitest suite          | PASS, 144 files, 565 tests; 1 file and 2 tests skipped by existing suite configuration |
| M11 analyzer tests         | PASS, 5 tests                                                                          |
| TypeScript build           | PASS, `npm run typecheck`                                                              |
| New M11 files ESLint       | PASS                                                                                   |
| New M11 files Prettier     | PASS                                                                                   |
| Portable manifest verifier | PASS, 41,254 files                                                                     |

Repository-wide ESLint/Prettier commands still report pre-existing findings in generated Unity `Library/Bee` files and unrelated legacy scripts; those files were not changed by this slice.

## Post-M11 runtime video smoke

The follow-up runtime wiring was exercised against the existing data directory and one real device after waking the device from `Dozing`:

| Check        | Result                                                                |
| ------------ | --------------------------------------------------------------------- |
| Evidence     | `data/hardware-m11-runtime-video/runtime-video.json`                  |
| Device       | `R5CX211TXNT`                                                         |
| Provider     | Serial-bound Tango scrcpy provider                                    |
| Frame        | H.264, `1080x2336`, frame `16`, payload `2,053` bytes                 |
| Reused state | Existing `ONLINE` device record was synchronized at coordinator start |
| Cleanup      | Provider returned to `STOPPED`; runtime closed successfully           |

## Post-M11 Appium screenshot capture foundation

The worker-owned Appium session now exposes a lifecycle-safe screenshot capture contract:

| Check                              | Result                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `DeviceWorker.captureScreenshot()` | READY-only, current `SessionFence` bound, returns base64 plus action viewport metadata |
| Runtime worker coordinator         | Returns a run/serial-scoped capture handle; stopped runs invalidate the handle         |
| Focused tests                      | PASS, 17 tests across worker and coordinator suites                                    |
| Full regression                    | PASS, 144 files / 565 tests                                                            |

This contract is consumed by the configured runtime provider and video gateway in the smoke recorded below; the separate acceptance boundary is the recorded leader-video artifact, which is still not published.

## Post-M11 Appium screenshot fallback smoke

The configured runtime now selects the serial-bound Appium screenshot provider when the pinned scrcpy asset is absent, and fails over to it when the primary provider cannot start. The console keeps the WebSocket open without H.264 support so a degraded JPEG frame can still be displayed.

Evidence: `data/hardware-m11-runtime-screenshot-fallback/runtime-screenshot-fallback.json`

| Check    | Result                                                      |
| -------- | ----------------------------------------------------------- |
| Mode     | `APPIUM_ONLY`, no Unity QA Bridge injection                 |
| Device   | `192.168.22.73:5555`                                        |
| Package  | `com.hg.idleweaponshoptycoon.android`                       |
| Primary  | Invalid scrcpy fixture intentionally failed                 |
| Fallback | `screenshot`, `DEGRADED`, `PRIMARY_PROVIDER_UNAVAILABLE`    |
| Frame    | JPEG, `1080x2340`, frame `1`, payload `113,572` bytes       |
| Cleanup  | Runtime closed, invalid fixture removed, session `FINISHED` |

The acceptance script is `scripts/accept-m11-runtime-screenshot-fallback.mjs`; it uses an isolated E-drive data root and removes its invalid primary fixture after the run.

## Post-M11 leader video publication smoke

The same Appium-only runtime now starts the optional leader recorder at session start, stops it before report finalization, and publishes the run-relative video artifact through the atomic evidence publisher.

Evidence: `data/hardware-m11-runtime-screenshot-fallback/runtime-screenshot-fallback.json`
Run: `run-90315d0a-9abf-4a79-8843-f18937ffac63`

| Check        | Result                                                             |
| ------------ | ------------------------------------------------------------------ |
| Device       | `R5CX211TXNT` (USB, `SM-S9280`)                                    |
| Package      | `com.hg.idleweaponshoptycoon.android`                              |
| Recording    | `video/leader.mp4`, `1,048,624` bytes, `VIDEO=READY`               |
| Hash         | `d92e576e66d814b5fcaaa87854401455b80c2672fdefc0009e6e8dc3b1df1e39` |
| HTML / ZIP   | Both `READY`; ZIP `1,051,890` bytes                                |
| Finalization | `COMPLETED`                                                        |
| Cleanup      | Runtime closed, invalid scrcpy fixture removed, session `FINISHED` |

The recorder uses MP4 for the current scrcpy 3.1 plus Android 16 device combination: the same real-device H.264 stream produced a zero-byte MKV on graceful shutdown but a valid MP4 artifact. The low-level process keeps MKV as its backwards-compatible default and accepts an explicit format.

## Known limitations and acceptance boundary

- The portable runtime now wires the pinned scrcpy 3.1 server asset into a serial-bound Tango `ViewProvider` when the asset is present, and the authenticated video gateway starts it on demand. The 60-minute result in this acceptance predates runtime video recording; the separate post-M11 smoke above proves the current leader-video publication path.
- Appium screenshot fallback and leader-video publication are implemented and verified on a real Android device. Screenshot fallback still requires an active `RUNNING` worker-owned Appium session; without one, the degraded provider remains unavailable.
- The `unity-command` build provider is available as an opt-in adapter. It invokes a configured absolute Unity executable with shell-free argument arrays and reuses the immutable artifact-import pipeline. The default Apps route still uses `artifact-import`; enabling command builds for a concrete Unity project requires an explicit arguments builder, signing profile, and real package acceptance.
- Runtime registration is gated by `TEST_CENTER_UNITY_EXECUTABLE_PATH`, `TEST_CENTER_UNITY_PROJECT_PATH`, and `TEST_CENTER_UNITY_BUILD_ARGS_JSON`; when these are absent, provider discovery intentionally exposes only `artifact-import`.
- Fault injection and active-session recovery acceptance remain skipped per prior user confirmation.

## M0-M11 traceability

Prior milestone records remain the source of truth: [M0](M0-acceptance.md), [M1](M1-acceptance.md), [M2](M2-acceptance.md), [M3](M3-acceptance.md), [M5](M5-acceptance.md), [M6](M6-task1-acceptance.md), [M7](M7-console-session-ui-acceptance.md), [M8](M8-device-worker-managed-lifecycle-acceptance.md), [M9](M9-acceptance.md), [M10](M10-acceptance.md), [M11 Task 1](M11-task1-excel-acceptance.md), [M11 Task 2a](M11-task2a-junit-acceptance.md), [M11 Task 2b](M11-task2b-pdf-acceptance.md), [M11 Task 3a](M11-task3a-export-queue-acceptance.md), [M11 Task 3b](M11-task3b-results-export-acceptance.md), [M11 Task 4](M11-task4-portable-acceptance.md), and [M11 Task 6](M11-task6-real-package-acceptance.md).

## Decision

**M11 portable delivery, clean real-device flow, optional exports, stability analyzer, Appium-only screenshot fallback, leader-video publication, and 60-minute Appium-only two-device run: PASS locally. Runtime scrcpy provider wiring, screenshot fallback, and recorded leader-video evidence are implemented and verified locally.**

All source changes are intentionally uncommitted and unpushed pending explicit user approval. Do not merge, tag, create a GitHub Release, or delete the clean extraction before final acceptance.
