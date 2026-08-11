# M6 Task 5 Session API Acceptance

Date: 2026-08-11
Scope: create/detail session API for one leader device.

## Delivered

- Added authenticated `POST /api/sessions` and `GET /api/sessions/:id` routes.
- POST validates package name, Android serial, client request ID, leader-video flag, same-origin, session cookie, and CSRF.
- Runtime SQLite service persists `test_runs`, one active Leader row in `run_devices`, and the initial `CREATED` transition.
- Migration `0009_session_api` adds a unique client request ID and persisted leader-video preference.
- Repeating the same client request with the same payload returns `DEDUPLICATED`; a different payload is rejected.
- Offline or missing devices are rejected before a run is created.

## Verification

| Check | Result |
| --- | --- |
| Session route tests | 2/2 passed |
| Runtime SQLite service tests | 2/2 passed |
| Full Vitest | 69 files, 258 tests passed |
| `npm run typecheck` | Passed |
| Targeted Prettier | Passed |
| Targeted ESLint | Passed |
| CodeGraph sync | Added 4 files, modified 6 files; index up to date |

## Boundary

This slice does not implement preflight/start/pause/finish, action submission, evidence registration from session events, WebCodecs viewport input, or console UI changes. Those remain separate atomic slices.
