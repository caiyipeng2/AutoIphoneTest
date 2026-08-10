# M6 Task 2 Local Acceptance

Date: 2026-08-10
Scope: fenced Appium W3C client, typed serial-bound logcat stream, and single-device worker lifecycle.

## Implemented

- `AppiumW3cClient` only exposes session create/delete, pointer actions, screenshot, app activation/termination, key press, text input, current package/activity, and settings.
- Session capabilities are fixed to Android + UiAutomator2 with explicit `udid`, system/MJPEG ports, `noReset=true`, and `newCommandTimeout`.
- Requests enforce loopback Appium base URLs, timeouts, response byte limits, Zod response validation, stable error categories, and session/serial/generation fences.
- `LogcatStream` runs the closed serial command `adb -s <serial> logcat -v threadtime` without shell interpolation, adds host monotonic receive times, bounds the ring buffer and raw segments, hashes/renames completed segments, and recovers `.partial` files.
- `DeviceWorker` verifies serial/package identity before allocating ports, creates the Appium session, starts logcat, enters `READY`, and rolls back owned resources on failure. Stop advances the worker generation.

## Verification

- Full Vitest: 56 files, 229 tests passing.
- TypeScript project build: passing.
- New Appium/ADB/session source ESLint: passing.
- New TypeScript/JSON Prettier check: passing.
- CodeGraph index: current and up to date.
- Full ESLint remains blocked only by three pre-existing errors in `packages/bridge` (`arm-controller.ts` and `clock-calibrator.ts`); no new-file lint errors were found.

## Limitations

This is the Task 2 local foundation. A concrete server wiring, real worker action dispatch, Unity bridge/view resources, video provider, crash reconciliation, and complete M6 real-input acceptance remain subsequent slices.
