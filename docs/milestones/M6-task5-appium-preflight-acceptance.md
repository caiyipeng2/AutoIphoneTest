# M6 Task 5 Appium Preflight Acceptance

Date: 2026-08-11
Scope: bind session preflight to a project-local Appium UiAutomator2 worker and verify the target Unity game on one Android device.

## Implementation

- `packages/sessions/src/appium-preflight.ts` creates a serial-bound W3C session with Android, UiAutomator2, `udid`, `systemPort`, `mjpegServerPort`, `noReset`, and `newCommandTimeout` capabilities.
- The probe activates the configured package, polls the foreground package for a bounded window to absorb Android launch transitions, and always deletes the Appium session.
- `apps/server/src/device-runtime.ts` injects the probe into `RuntimeSessionRouteService` when `TEST_CENTER_APPIUM_URL` is set. Without that variable the existing online-device preflight remains available.
- `scripts/accept-m6-appium-preflight.mjs` writes a JSON acceptance record under `data/runs/` and records the Appium log path.

## Automated verification

| Check                  | Result                  |
| ---------------------- | ----------------------- |
| Appium preflight tests | 3/3 passed              |
| Full Vitest            | 70 files, 261 tests     |
| `npm run typecheck`     | Passed                  |
| Targeted ESLint        | Passed                  |
| Targeted Prettier      | Passed                  |

## Real device acceptance

Device: `R5CX211TXNT` (`SM-S9280`, Android API 36)

Target package: `com.hg.idleweaponshoptycoon.android` (version `2.0.6`)

Appium: `3.6.0`, UiAutomator2 server `10.3.5`, `systemPort=8201`, `mjpegServerPort=7811`

Result: **PASS**. The probe created the W3C session, activated the Unity activity, waited through the transient `com.qent.probe` foreground state, observed the target package, and closed the session.

Evidence: `data/runs/m6-appium-preflight-1786433313749/acceptance.json`

Appium log: `data/logs/appium-m6-preflight.log`

## Earlier failure and correction

The first attempt after reconnecting the device observed `com.qent.probe` immediately after activation and failed the strict foreground check. Android logcat and a direct `am start -W` check confirmed the target Unity process was running and became the focused activity. The probe now uses bounded polling to represent this real launch transition; the follow-up run passed.

## Boundary

This verifies one-device Appium preflight binding only. Multi-device fan-out, synchronized actions, pause/finish, evidence registration from session events, WebCodecs input, and console UI remain separate slices.
