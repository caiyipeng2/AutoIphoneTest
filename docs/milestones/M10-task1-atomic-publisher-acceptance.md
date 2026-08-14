# M10 Task 1: Atomic Evidence Publisher

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice adds file-level publication for one evidence item. It accepts an iterable or async iterable of bytes, writes a same-directory `.partial-<attempt>-<uuid>` sibling, closes and syncs it, streams a SHA-256 hash after close, and atomically renames it to the validated final relative path.

The publisher rejects absolute/traversal paths, refuses to overwrite an existing final file, and removes the partial file when the content stream fails. It reports `READY`, normalized relative path, byte size, and SHA-256. Database rows, startup orphan reconciliation, report exports, and retry state are intentionally outside this slice.

## Verification evidence

| Check                             | Result                                                   |
| --------------------------------- | -------------------------------------------------------- |
| TDD red run before implementation | PASS: module-not-found failure for `atomic-publisher.js` |
| Atomic publisher tests            | PASS, 4 tests                                            |
| Evidence package tests            | PASS, 4 files / 15 tests                                 |
| Full Vitest suite                 | PASS, 92 files / 380 tests                               |
| TypeScript build                  | PASS                                                     |
| ESLint                            | PASS                                                     |
| New-file Prettier check           | PASS                                                     |
| `git diff --check`                | PASS                                                     |

## Files

- `packages/evidence/src/atomic-publisher.ts`
- `packages/evidence/src/atomic-publisher.test.ts`
- `packages/evidence/src/index.ts`

## Remaining M10 Task 1 work

The next slice must add evidence/report persistence and migration `0009_evidence_reports.sql`, including durable `PENDING -> READY|FAILED|MISSING` state, stable attempt metadata, and startup reconciliation of orphaned partials. Logcat redaction, offline HTML, ZIP64, finalization recovery, Results history, storage cleanup, and crash fixtures remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
