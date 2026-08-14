# M9 Actions and Failure Policies Acceptance

Date: 2026-08-14
Repository: `E:\Projects\UnityMultiDeviceTestCenter`
Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

M9 covers the closed action set, typed incidents, deterministic `PAUSE_ALL` / `QUARANTINE_FAILED_DEVICE` decisions, persisted recovery evidence, incident timeline, test-only fault injection, and hardware acceptance. M10 was not started.

## Implementation evidence

| Area                                                                                  | Result                                                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Closed actions: tap, long press, drag/swipe, Back, text, activate, terminate, restart | Implemented and covered by existing action tests                                                                |
| Nine incident categories and deterministic policy decisions                           | Implemented; leader, sole-member, unknown-member, and LOW_DISK force pause                                      |
| Failure policy persistence                                                            | Implemented with migration `0013_run_failure_policy`; session API and runtime monitors read the selected policy |
| Incident/recovery persistence and deduplication                                       | Implemented in SQLite; recovery decisions are immutable after completion                                        |
| Incident timeline/filter/details UI                                                   | Implemented and tested                                                                                          |
| Test-only fault source                                                                | `tests/faults/fake-fault-controller.ts`, no production route                                                    |
| Plaintext evidence scan                                                               | PASS, 6,631 files scanned, 0 hits                                                                               |
| Explicit bridge mode                                                                  | `TEST_CENTER_BRIDGE_MODE=required` remains the strict default; `optional` selects Appium-only explicitly       |
| Managed Appium-only action path                                                       | Worker-owned Appium session executes tap/swipe/long press/drag/text/Back/lifecycle actions without QA Bridge  |
| Worker startup cleanup                                                                 | Sequential 1-4 worker establishment avoids concurrent UiAutomator2 bootstrap races; dispatch remains parallel |
| Automated suite                                                                       | PASS, 89 files / 365 tests                                                                                      |
| TypeScript build                                                                      | PASS                                                                                                            |
| ESLint                                                                                | PASS                                                                                                            |
| `git diff --check`                                                                    | PASS                                                                                                            |

## Hardware acceptance

ADB reported these online targets before the run:

- `R5CWB17PN0Y` / `SM_A5460`
- `t4vswkqcs4uc8pob` / `2312DRAABC`
- `192.168.22.191:5555` / `SM_A5460` (same model as the first target; not included in this matrix)

The current ADB snapshot contained one online target, `192.168.22.191:5555` (`SM_A5460`). The Android UiAutomator2 Appium driver was installed both in the user Appium Home and in the worker's E-drive Appium Home. The action matrix passed activate, Back, long press/drag, terminate, and restart; package foreground and process postconditions were verified.

The production package was then run through the new explicit Appium-only managed path with `TEST_CENTER_BRIDGE_MODE=optional`. A real device reached `CREATED -> PREFLIGHT -> RUNNING`, and a normalized tap was executed through the worker-owned Appium session with a persisted `SUCCEEDED` target result. No Unity QA Bridge listener or `QA_HELLO`/`QA_STATE` handshake is required in this mode. Text input uses Appium native text input; Bridge-backed focus verification remains intentionally unavailable in Appium-only mode.

Two-device session creation and preflight succeeded with `R5CX211TXNT` and `t4vswkqcs4uc8pob`, but the current hardware run did not reach `RUNNING`: one UiAutomator2 `POST /session` request failed during managed startup. The failure was not converted into a multi-device PASS. The coordinator now starts workers sequentially to avoid concurrent device-side bootstrap races; a repeat with both devices continuously online is still required.

Per user confirmation, active-session fault injection and incident/recovery acceptance are temporarily skipped. The existing fault harness remains test-only and unchanged; no production fault route was added.

## Acceptance decision

**M9 implementation: READY FOR REVIEW. M9 single-device Appium-only action acceptance: PASS. M9 two-device hardware acceptance: PENDING REPEAT. M9 active-session fault-policy acceptance: SKIPPED BY USER.**

The Appium driver/device discovery blocker is resolved for the current environment. Appium-only operation is explicit and does not silently weaken the strict Bridge default. M10 remains unopened until the user approves this M9 slice and the two-device hardware repeat is completed; fault-policy verification can be resumed later when requested.

Local changes are intentionally uncommitted and unpushed pending user approval.
