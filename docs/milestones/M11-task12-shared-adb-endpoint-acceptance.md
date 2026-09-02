# M11 Task 12: Portable Shared ADB Endpoint Acceptance

Date: 2026-09-02

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Problem and fix

The portable smoke runner already passed `TEST_CENTER_APPIUM_ADB_PORT` to Appium,
but its direct `adb devices` and package checks defaulted to port `5037`. When the
connected devices were hosted by the project's shared ADB server on `5038`, the
runner incorrectly reported an offline device before creating a session.

`tests/hardware/m11-portable-smoke.ts` now derives `ADB_SERVER_SOCKET` and
`ANDROID_ADB_SERVER_PORT` from `TEST_CENTER_APPIUM_ADB_PORT` or
`TEST_CENTER_ADB_SERVER_PORT`, and uses that environment for both direct ADB calls
and the portable server child process.

## Fresh two-device verification

ADB server: `D:\ADB\platform-tools\adb.exe -P 5038`

| Serial        | Device            | Result |
| ------------- | ----------------- | ------ |
| `R5CX211TXNT` | Samsung S24 Ultra | PASS   |
| `ZT4229J5ZR`  | moto g 2025       | PASS   |

The smoke runner was invoked with only `TEST_CENTER_APPIUM_ADB_PORT=5038` and
`TEST_CENTER_ADB_SERVER_PORT=5038`; no manual `ANDROID_ADB_SERVER_PORT` or
`ADB_SERVER_SOCKET` was supplied.

| Check               | Result                             |
| ------------------- | ---------------------------------- |
| Session             | `PREFLIGHT -> RUNNING -> FINISHED` |
| Tap                 | `SUCCEEDED` on both devices        |
| Swipe               | `SUCCEEDED` on both devices        |
| HTML / ZIP          | `READY`                            |
| Excel / PDF / JUnit | `READY`                            |

Session: `run-20b7d1ab-d1cd-43ae-ac37-07c3a8441b4c`

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-portable-dual-20260902-auto-port\m11-portable-smoke.json`

## Verification

- Endpoint regression: PASS.
- Full Vitest after this change: `612 passed / 2 skipped`.
- TypeScript, ESLint, targeted Prettier and `git diff --check`: PASS.
- Both devices remained online after cleanup; no ADB forward remained.
