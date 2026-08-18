# M10 Task 4: Session Completion Finalization Acceptance

## Scope

This atomic slice connects a terminal session transition to the report finalization executor. It supports explicit `FINISHED`, `FAILED`, and `INTERRUPTED` outcomes without dispatching another device action.

## Delivered

- Added protected `POST /api/sessions/:id/complete` with a required terminal state and bounded reason.
- Added `SessionRouteService.complete` and the SQLite transition from `RUNNING` or `PAUSED` to the requested terminal state.
- Completion stops the managed worker, cancels queued actions, and records `SESSION_COMPLETED:<reason>` in `run_transitions`.
- Runtime completion starts `ReportFinalizationExecutor.startFinalization` after the terminal transaction; report failures remain visible through Results retry state and do not roll back the session outcome.
- Added a first-run executor entry point without an idempotency key. The existing Results retry path remains idempotency-key protected.
- Canonicalized the Results export root before containment checks so Windows 8.3 temporary paths do not reject valid files after `realpath` expansion.

## Verification

- Session route, runtime, Results export, and executor focused tests: 24/24 passed.
- Full suite: 115 files, 453 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for the edited route, session, test, and report executor files.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Automatic completion from device worker exit or Unity game process exit.
- Crash-injection acceptance during HTML/ZIP publication.
- Storage retention, optional M11 exports, and real Android completion/report acceptance.

## Approval gate

Implementation and local verification are complete. The changes remain uncommitted and unpushed until explicit user approval.
