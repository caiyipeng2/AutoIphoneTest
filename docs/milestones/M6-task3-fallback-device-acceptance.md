# M6 Task 3 Fallback View and Device Acceptance

Date: 2026-08-10
Scope: bounded latest-frame buffer, serial-bound Appium screenshot fallback, Appium 3 capability fencing, Logcat close-race hardening, and one-device acceptance.

## Implemented

- `@test-center/video` provides a two-frame bounded buffer and monotonic frame IDs.
- `MjpegViewProvider` currently uses Appium screenshots as an explicitly degraded fallback, enforces a maximum of two captures per second, tracks metrics epochs, and binds every frame to the configured serial.
- Appium W3C session creation now sends Android-specific capabilities with the required `appium:` vendor prefix.
- Logcat segment closing is idempotent when the child-process close callback races with explicit worker shutdown.
- `scripts/accept-m6-task3-device.mjs` performs a repeatable local-device acceptance flow and writes a JSON evidence record.

## Real-device acceptance

Evidence: `E:\Projects\UnityMultiDeviceTestCenter\data\runs\m6-task3-1786334239249\acceptance.json`

- Device: `R5CX211TXNT` / `SM-S9280`, physical display `1080x2340`.
- Target package: `com.hg.idleweaponshoptycoon.android`.
- Launcher: `com.hg.idleweaponshoptycoon.android/com.unity3d.player.UnityPlayerActivity`.
- Appium: `3.6.0`, loopback port `4723`, session created and deleted successfully.
- Foreground check: Appium and ADB both reported the target game package after explicit launcher start.
- Screenshot fallback: frame `1`, `1,108,759` bytes, `1080x2340`, provider `screenshot`, explicitly `degraded=true` because the primary provider is not installed yet.
- Input: Android keycode `82` and a W3C pointer tap at `(5,5)` completed; target package remained foreground.
- Logcat: `7` serial-bound hashed segments, `436,329` parsed records; no partial segment remained.
- Cleanup: Appium session deleted and owned Appium process stopped.

## Automated verification

- New video tests: `4` passing.
- Appium W3C regression: `6` passing, including Appium 3 capability prefixing.
- Logcat regression: `4` passing, including concurrent close/stop handling.
- Full Vitest and TypeScript verification are rerun before approval.

## Limitations

This slice intentionally does not claim the primary Tango/scrcpy 3.1 stream, WebSocket video gateway, video recording, or server-managed worker/view wiring. The fallback frame is suitable for device acceptance and degraded UI plumbing, but it is not evidence that the primary video latency gate has passed.
