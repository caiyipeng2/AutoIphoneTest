# M10 Task 1: Evidence Repository State Machine

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice connects the M10 evidence schema to a repository-level state machine. New records start at `PENDING`; publication can move them to `READY` with a validated relative path, lowercase SHA-256, byte size, and capture time; capture failures move them to `FAILED`; explicitly unavailable captures move them to `MISSING` with an allowed reason. Every terminal transition is guarded by `state = 'PENDING'`, so `READY`, `FAILED`, and `MISSING` cannot be overwritten or replayed.

Startup reconciliation is explicit and conservative. It requires the run root, inspects declared final and temporary paths, never promotes an existing final or partial file to `READY`, and marks orphaned pending rows as `ORPHANED_PENDING` or `ORPHANED_PARTIAL` failures. Reconciliation is idempotent because only pending rows are updated.

## Verification evidence

| Check                                           | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| TDD red run before implementation               | PASS: missing `evidence-repository.js` module |
| Evidence repository tests                       | PASS, 4 tests                                 |
| Evidence package tests                          | PASS, 5 files / 19 tests                      |
| Full Vitest suite                               | PASS, 94 files / 387 tests                    |
| TypeScript build                                | PASS                                          |
| ESLint                                          | PASS                                          |
| Prettier check for changed package/config files | PASS                                          |
| `git diff --check`                              | PASS                                          |
| Lockfile synchronization                        | PASS: workspace dependency metadata updated   |

## Files

- `packages/evidence/src/evidence-repository.ts`
- `packages/evidence/src/evidence-repository.test.ts`
- `packages/evidence/src/index.ts`
- `packages/evidence/package.json`
- `packages/evidence/tsconfig.json`
- `package-lock.json`

## Remaining M10 Task 1 work

The next slice should connect repository transitions to the atomic publisher and add redacted logcat evidence capture. Report model/HTML, ZIP64, finalization retry, Results history, storage cleanup, and crash fixtures remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
