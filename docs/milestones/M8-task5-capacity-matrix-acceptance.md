# M8 Task 5: Capacity Matrix Runner Acceptance

Date: 2026-09-01

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

Runtime: E-drive portable server, Appium-only managed mode, shared ADB server `5038`

## Runner

`tests/hardware/m8-capacity-matrix.ts` is the reproducible M8 capacity entry point.
It requires `TEST_CENTER_M8_SERIALS` with 1-4 explicit unique serials and runs each
available capacity in a fresh `m11-portable-smoke.ts` child process. Each capacity
gets its own evidence and log directory. Missing capacities are reported as
`HARDWARE_UNAVAILABLE` and never substituted with fixtures or fake serials.

Setting `TEST_CENTER_M8_REQUIRE_FOUR=true` activates the final four-device gate;
with fewer than four serials the runner exits `2` before starting any child run.

## Current real-device result

| Capacity | Devices                     | Result               | Evidence                             |
| -------- | --------------------------- | -------------------- | ------------------------------------ |
| 1        | `R5CX211TXNT`               | PASS                 | `capacity-1/m11-portable-smoke.json` |
| 2        | `R5CX211TXNT`, `ZT4229J5ZR` | PASS                 | `capacity-2/m11-portable-smoke.json` |
| 3        | only 2 serials available    | HARDWARE_UNAVAILABLE | No child run started                 |
| 4        | only 2 serials available    | HARDWARE_UNAVAILABLE | No child run started                 |

For capacities 1 and 2, each child run completed `PREFLIGHT -> RUNNING -> FINISHED`.
Tap and swipe target results were `SUCCEEDED` for every selected device, and the
mandatory HTML/ZIP plus optional Excel/PDF/JUnit exports reached `READY`.

Evidence root:

`E:\Temp\UnityMultiDeviceAcceptance\m8-capacity-matrix-20260901\m8-capacity-matrix.json`

Strict-gate evidence root:

`E:\Temp\UnityMultiDeviceAcceptance\m8-capacity-matrix-strict-20260901\m8-capacity-matrix.json`

## Verification

- Capacity runner contract test: PASS, 1 test.
- Strict four-device gate: exit code `2`, no child deployment/action run.
- Full Vitest after this slice: `607 passed / 2 skipped`.
- TypeScript, ESLint, targeted Prettier and `git diff --check`: PASS.

## Boundary

This slice proves reproducible 1/2-device real capacity execution and safe 3/4-device
hardware gating. It does not claim M8 final acceptance, three/four-device execution,
or the 30-minute/1,000-action soak. Those require additional physical Android devices
and the dedicated soak/analyzer slice.
