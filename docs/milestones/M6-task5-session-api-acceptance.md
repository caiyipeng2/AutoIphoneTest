# M6 Task 5 Session API Acceptance

Date: 2026-08-11
Scope: create/detail and preflight/start lifecycle API for one leader device.

## Delivered

- Added authenticated `POST /api/sessions` and `GET /api/sessions/:id` routes.
- POST validates package name, Android serial, client request ID, leader-video flag, same-origin, session cookie, and CSRF.
- Runtime SQLite service persists `test_runs`, one active Leader row in `run_devices`, and the initial `CREATED` transition.
- Migration `0009_session_api` adds a unique client request ID and persisted leader-video preference.
- Repeating the same client request with the same payload returns `DEDUPLICATED`; a different payload is rejected.
- Offline or missing devices are rejected before a run is created.
- `POST /api/sessions/:id/preflight` advances `CREATED` to `PREFLIGHT` after an online-device check.
- `POST /api/sessions/:id/start` advances `PREFLIGHT` to `RUNNING`; stale state transitions are rejected.
- Both lifecycle mutations require the same session, origin, and CSRF checks as create.
- Preflight now accepts an injected `SessionPreflightProbe` and awaits its serial/package capability check before committing `PREFLIGHT`.
- The runtime binds `AppiumPreflightProbe` when `TEST_CENTER_APPIUM_URL` is configured; system and MJPEG ports remain environment-configurable.

## Verification

| Check                        | Result                                            |
| ---------------------------- | ------------------------------------------------- |
| Session route tests          | 2/2 passed                                        |
| Runtime SQLite service tests | 2/2 passed                                        |
| Full Vitest                  | 69 files, 258 tests passed                        |
| `npm run typecheck`          | Passed                                            |
| Targeted Prettier            | Passed                                            |
| Targeted ESLint              | Passed                                            |
| CodeGraph sync               | Added 4 files, modified 6 files; index up to date |

## Boundary

The probe is intentionally optional when Appium is not configured, so local route tests and non-Appium deployments keep working. Action submission, pause/finish, evidence registration from session events, WebCodecs input, and console UI remain separate atomic slices.
