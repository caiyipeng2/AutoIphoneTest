# M10 Task 1: Evidence and Report Persistence Schema

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice adds the SQLite schema for evidence records and report export attempts. Both tables persist stable IDs, run association, attempt numbers, temporary/final relative paths, SHA-256, byte size, timestamps, and failure metadata. Evidence records also retain optional action/serial association and the explicit unavailable reason used by the mandatory capture matrix.

The schema accepts only `PENDING`, `READY`, `FAILED`, and `MISSING` states. Evidence kinds, report formats (`HTML`/`ZIP`), SHA-256 shape, non-negative sizes, positive attempts, and allowed unavailable reasons are constrained by SQLite checks. Pending indexes support startup reconciliation in a later slice.

Because migrations `0009` through `0013` already exist in the current repository, the implementation uses migration ID `0014_evidence_reports`; this avoids reusing the existing `0009_session_api` ID while preserving the M10 schema intent. The SQL source is also recorded at `packages/database/src/migrations/0014_evidence_reports.sql`.

## Verification evidence

| Check                             | Result                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| TDD red run before implementation | PASS: undefined migration caused the migration tests to fail |
| Evidence/report migration tests   | PASS, 3 tests                                                |
| Database package tests            | PASS, 3 files / 11 tests                                     |
| Full Vitest suite                 | PASS, 93 files / 383 tests                                   |
| TypeScript build                  | PASS                                                         |
| ESLint                            | PASS                                                         |
| TypeScript Prettier check         | PASS                                                         |
| `git diff --check`                | PASS                                                         |

## Files

- `packages/database/src/migrations.ts`
- `packages/database/src/migrations/0014_evidence_reports.sql`
- `packages/database/src/evidence-reports-migration.test.ts`

## Remaining M10 Task 1 work

The next slice adds the evidence repository state machine and startup reconciliation of orphaned `PENDING` records. It will connect the file publisher result to durable `READY`/`FAILED`/`MISSING` updates without allowing terminal-state overwrites. Logcat redaction, offline HTML, ZIP64, finalization recovery, Results history, storage cleanup, and crash fixtures remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
