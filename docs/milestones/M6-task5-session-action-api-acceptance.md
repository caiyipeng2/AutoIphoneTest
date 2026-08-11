# M6 Task 5 Session Action API Acceptance

Date: 2026-08-11
Scope: authenticated session action submission backed by the persisted single-device action/outbox foundation.

## Delivered

- Added `POST /api/sessions/:id/actions` with the same host, origin, session-cookie, and CSRF protections as other session mutations.
- Validates tap/swipe payloads, normalized coordinates, path length, duration, metrics epoch, and optional source frame ID before calling the runtime service.
- Returns `201 CREATED` for a new action and `200 DEDUPLICATED` for an idempotent retry.
- Runtime action submission delegates to `RunActionRepository`, so actions are accepted only while `RUNNING` and persist targets/results/outbox transactionally.
- Payload conflicts, in-flight actions, non-running sessions, missing sessions, and unavailable services map to stable HTTP errors.

## Verification

| Check                   | Result                                    |
| ----------------------- | ----------------------------------------- |
| Session route/API tests | 2 files, 4 tests passed                   |
| Full Vitest             | 72 files, 269 tests passed                |
| `npm run typecheck`     | Passed                                    |
| Targeted ESLint         | Passed                                    |
| Targeted Prettier       | Passed                                    |
| CodeGraph sync          | Index up to date, 243 files / 3,409 nodes |

## Boundary

The endpoint currently persists and queues the action but does not automatically lease the outbox, call the Appium action executor, or complete device results. Direct single-device Appium tap/swipe execution remains covered by `M6-task4-appium-action-acceptance.md`; wiring the dispatcher and result completion is the next atomic slice.
