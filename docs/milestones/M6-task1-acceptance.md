# M6 Task 1 Local Acceptance

Date: 2026-08-07
Scope: project-local Appium provisioning, loopback service supervision, and one explicit Android device session.

## Environment

- Project: `E:\Projects\UnityMultiDeviceTestCenter`
- Portable Node: `22.23.1`, SHA-256 verified by `scripts/bootstrap-node.ps1`
- Appium: `3.6.0`
- UiAutomator2: `8.2.2`
- Appium home: `E:\Projects\UnityMultiDeviceTestCenter\data\appium-home`
- Device serial: `R5CX211TXNT`
- Device model: `SM-S9280`
- Android: `16`
- Physical display: `1080x2340`

## Evidence

1. `scripts/provision-appium.ps1` completed successfully and reported Appium `3.6.0` plus UiAutomator2 `8.2.2`.
2. `AppiumService` started on loopback port `4723`, returned PID `5336` and version `3.6.0`, then completed owned process-tree shutdown.
3. An explicit W3C session returned HTTP `200` with session id `25ed7ed7-eda8-4aa4-8f03-a6e332562235` and these capabilities:
   - `udid=R5CX211TXNT`
   - `automationName=UiAutomator2`
   - `systemPort=8200`
   - `mjpegServerPort=7810`
   - `noReset=true`
4. The session was deleted immediately after capability verification. No game package, test data, or account state was changed.

## Automated Checks

- Task 1 tests: 11 passing after the portable Node CLI-prefix regression test.
- Full Vitest regression: 53 files, 217 tests passing.
- TypeScript project build: passing.
- New Appium source ESLint: passing.
- PowerShell provisioning script parse: passing.

## Limitations

This acceptance proves the project-local Appium and UiAutomator2 device-session foundation. It does not yet prove M6 video streaming, action dispatch, Unity game input, crash reconciliation, or evidence-manifest indexing; those are later M6 tasks.
