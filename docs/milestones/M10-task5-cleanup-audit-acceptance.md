# M10-T5 Cleanup Audit Acceptance

## Scope

This slice adds the persistent state and append-only audit boundary required before cleanup orchestration. It does not delete, move, or restore run artifacts.

## Delivered

- Added migration `0017_cleanup_audit`.
- Added `test_runs.cleanup_state` with the states `ACTIVE`, `DELETING`, `DELETED`, and `RECOVERY_REQUIRED`.
- Added append-only `cleanup_audit_events` rows with ordered sequences and optional run/path/error details.
- Added `CleanupAuditRepository.markDeleting()` with sorted run identifiers, existence checks, and an atomic `ACTIVE -> DELETING` compare-and-set transition.
- Added `appendEvent()` and `listEvents()` with identifier and event-shape validation.
- Registered the migration in the server runtime migration chain.

## Verification

- Focused cleanup audit tests: 3/3 passed.
- Full Vitest suite: 123 test files, 492 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Prettier checks for the new and directly edited evidence/database files: passed.
- `git diff --check`: passed.
- CodeGraph sync: passed; 5 changed files indexed.

## Explicitly Not Included

- No physical deletion or mover invocation.
- No `DELETED` or `RECOVERY_REQUIRED` transition orchestration.
- No cleanup API or visual audit page.
- No change to the existing user-confirmation or trash-mover behavior.

## Approval Gate

The implementation is verified locally and remains uncommitted and unpushed. Commit and push to `main` require explicit user approval.
