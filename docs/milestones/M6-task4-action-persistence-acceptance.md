# M6 Task 4 Action Persistence and Outbox Acceptance

Date: 2026-08-11
Scope: the single-device action transaction and crash-safe outbox foundation; device injection is intentionally outside this slice.

## Delivered

- Added `RunActionRepository` for normalized `tap` and `swipe` actions.
- Accepts actions only for a `RUNNING` run and snapshots active members from the current membership epoch.
- Creates the action row, target rows, pending device results, outbox row, and initial action transition in one SQLite transaction.
- Reusing the same `(runId, clientRequestId)` with the same canonical payload returns `DEDUPLICATED`; a changed type, payload, or metrics epoch is rejected.
- Enforces one queued/leased/dispatching action per run so action sequence assignment cannot interleave gestures.
- Added `ActionOutbox` lease and dispatching transitions with a lease token fence.
- Startup reconciliation marks queued work `CANCELLED` and leased/dispatching work `UNKNOWN`; it never invokes a device worker or replays a possibly sent action.

## Verification

| Check                                     | Result                                    |
| ----------------------------------------- | ----------------------------------------- |
| Action repository/outbox tests            | 5/5 passed                                |
| Existing session route/runtime regression | 2/2 files, 7/7 tests passed               |
| Full Vitest                               | 71 files, 266 tests passed                |
| `npm run typecheck`                       | Passed                                    |
| Targeted ESLint                           | Passed                                    |
| Targeted Prettier                         | Passed                                    |
| CodeGraph sync                            | Index up to date, 240 files / 3,355 nodes |

## Boundary

This slice does not expose a session action HTTP endpoint, dispatch W3C input through Appium, run the Unity QA arm/ACK barrier, map safe-area coordinates, or perform real tap/swipe hardware acceptance. Those remain the next atomic action-dispatch slices.
