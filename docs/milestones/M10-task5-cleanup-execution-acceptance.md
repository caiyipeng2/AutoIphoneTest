# M10-T5 Cleanup Execution Acceptance

## Scope

This slice wires confirmation, cleanup state transitions, same-volume trash movement, physical trash deletion, audit events, and recovery handling into one server-side execution service. It has no HTTP route or Console UI.

## Delivered

- Added `CleanupExecutionService` with a server-issued confirmation boundary.
- Normalizes and sorts Run IDs before consuming the confirmation and mutating state.
- Records `STARTED` and `RUN_MOVED` events before deleting moved trash directories.
- Marks all runs `DELETED` only after every trash deletion succeeds and records `COMPLETED`.
- On move failure, records per-run `MOVE_FAILED`, marks `RECOVERY_REQUIRED`, and records `ROLLED_BACK`.
- On partial deletion failure, restores only entries still present in trash, records `RUN_RESTORED`, marks `RECOVERY_REQUIRED`, and returns `deleted`, `restored`, and `unresolved` Run ID lists.
- Added validated reverse restoration to `CleanupTrashMover` and exported the execution service through `@test-center/evidence`.

## Verification

- Cleanup execution and mover focused tests: 8/8 passed.
- Full Vitest suite: 124 test files, 498 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Prettier checks for changed evidence files: passed.
- `git diff --check`: passed.

## Explicitly Not Included

- No storage cleanup HTTP route or Console dialog.
- No metadata row deletion beyond the existing run state transition.
- No background scheduling or automatic cleanup trigger.
- No commit or push has been made for this slice.

## Approval Gate

The implementation is locally verified and remains uncommitted and unpushed until explicit user approval.
