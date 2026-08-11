# M6 Task 6: Multi-Device Synchronized Action Acceptance

## Scope

This slice extends session creation from one leader to a variable set of one to four devices:

1. `deviceSerials` accepts one to four unique Android serials; the legacy `deviceSerial` field remains compatible for one-device callers.
2. The session view exposes `session.devices` with one `LEADER` followed by `FOLLOWER` members.
3. Preflight checks every member before the run enters `PREFLIGHT`.
4. An action snapshots every ACTIVE or RECOVERING member and dispatches to all targets concurrently.
5. Each target receives an independent Appium port offset; all device results must finish before the action becomes `SUCCEEDED` or `FAILED`.

## Automated verification

- Targeted session, repository, route tests: 14 passed.
- `npm run typecheck -- --pretty false`: passed.
- Targeted ESLint and Prettier checks: passed.

## True two-device verification

Prerequisites:

- Android devices: `R5CX211TXNT` (`SM-S9280`) and `R5CWB17PN0Y` (`SM-A5460`).
- Both devices: `device`, `1080x2340`, and package `com.hg.idleweaponshoptycoon.android` installed.
- Appium: `http://127.0.0.1:4723`, version `3.6.0`, ready.
- Secondary device package was installed from `idle_weaponshop_haiwai_v60_2026_08_07_21_06-release.apks` using the provided bundletool chain.

Command:

```powershell
$env:ANDROID_SERIALS = "R5CX211TXNT,R5CWB17PN0Y"
node scripts/accept-m6-session-action.mjs
```

Evidence:

- `data/runs/m6-session-action-1786441839279/acceptance.json`
- Session: `run-46b8783f-ff97-45e3-9b62-4e0d1c0f57f7`
- Members: leader `R5CX211TXNT`, follower `R5CWB17PN0Y`.
- Action: `act-e36ae6eb-30d7-4fb3-8c0f-4379d113160a`.
- Both target results: `SUCCEEDED`; each Appium result reported `pointerActionCount: 3`.
- Aggregate action: `SUCCEEDED`; outbox: `ACKED`, attempt count `1`.
- Appium ports: primary `8201/7811`, secondary `8202/7812`.

## Approval gate

The multi-device changes and this evidence document are verified locally and on both connected Android devices. They remain uncommitted until explicit approval for this slice.
