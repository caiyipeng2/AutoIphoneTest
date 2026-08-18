# M10-T5 Cleanup State Transitions Acceptance

## Scope

This atomic slice completes the persistent cleanup state transition boundary needed by the later execution orchestrator. It does not move or delete files.

## Delivered

- Added `CleanupAuditRepository.markDeleted()` for the guarded `DELETING -> DELETED` transition.
- Added `CleanupAuditRepository.markRecoveryRequired()` for the guarded `DELETING -> RECOVERY_REQUIRED` transition.
- Both transitions normalize and sort Run IDs, execute in an immediate transaction, update `updated_at`, and use a compare-and-set state predicate.
- Unknown runs and runs outside `DELETING` remain rejected without silently changing state.

## Verification

- Focused cleanup audit tests: 4/4 passed.
- Full Vitest suite: 123 test files, 493 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Prettier checks for the changed evidence files: passed.
- `git diff --check`: passed.

## Explicitly Not Included

- No confirmation consumption or mover invocation is wired into an execution service yet.
- No physical deletion, restore, unresolved-path reporting, API route, or Console UI.
- No commit or push has been made for this slice.

## Approval Gate

The implementation is locally verified and remains uncommitted and unpushed until explicit user approval.
