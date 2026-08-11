# M6 Task 4 Appium Action Acceptance

Date: 2026-08-11
Scope: single-device Appium W3C tap/swipe execution on the installed Unity game, using the normalized action payload produced by the persistence slice.

## Delivered

- Added `AppiumActionExecutor` with serial-bound Android/UiAutomator2 capabilities and bounded foreground-package polling.
- Added normalized-coordinate mapping to viewport pixels using `round(normalized * (dimension - 1))`, preventing an edge coordinate from exceeding the viewport.
- Tap emits one pointer move, pointer down, and pointer up sequence.
- Swipe emits a pointer move/down, evenly distributed move durations, and pointer up.
- Session cleanup runs on success and failure; no arbitrary Appium command surface is exposed.
- Added `scripts/accept-m6-appium-action.mjs` for repeatable hardware acceptance evidence.

## Automated verification

| Check                           | Result                     |
| ------------------------------- | -------------------------- |
| Appium action executor tests    | 3/3 passed                 |
| Action persistence/outbox tests | 5/5 passed                 |
| Full Vitest                     | 72 files, 269 tests passed |
| `npm run typecheck`             | Passed                     |
| Targeted ESLint                 | Passed                     |
| Targeted Prettier               | Passed                     |

## Real device acceptance

Device: `R5CX211TXNT` (`SM-S9280`, Android API 36)

Target package: `com.hg.idleweaponshoptycoon.android` (version `2.0.6`)

Appium: `3.6.0`, UiAutomator2 server `10.3.5`, `systemPort=8201`, `mjpegServerPort=7811`

Viewport: `1080x2340`

| Action                                      | Result                                             | Evidence                                                   |
| ------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Center tap `(0.5, 0.5)`                     | PASS; target package foreground; 3 pointer actions | `data/runs/m6-appium-action-1786436740790/acceptance.json` |
| Short swipe `(0.5,0.4)->(0.5,0.45)`, 300 ms | PASS; target package foreground; 4 pointer actions | `data/runs/m6-appium-action-1786436771864/acceptance.json` |

## Boundary

This proves direct single-device Appium action execution and does not yet wire actions to the session HTTP endpoint, lease/result completion, Unity QA arm/ACK correlation, or multi-device fan-out.
