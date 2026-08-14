# M10 Task 1: Evidence Publication Service

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice connects the atomic file publisher to the durable evidence repository. A pending record must have a matching attempt; successful publication writes the measured final relative path, SHA-256, byte size, and optional capture time as `READY`. Any publisher failure first records `PUBLISH_FAILED` as `FAILED`, then rethrows the original error so callers cannot mistake a failed capture for a successful one.

## Verification evidence

| Check                             | Result                                                 |
| --------------------------------- | ------------------------------------------------------ |
| TDD red run before implementation | PASS: missing `evidence-publication-service.js` module |
| Publication service tests         | PASS, 2 tests                                          |
| Evidence package tests            | PASS, 6 files / 21 tests                               |
| Full Vitest suite                 | PASS, 95 files / 389 tests                             |
| TypeScript build                  | PASS                                                   |
| ESLint                            | PASS                                                   |
| Prettier check                    | PASS                                                   |
| `git diff --check`                | PASS                                                   |

## Files

- `packages/evidence/src/evidence-publication-service.ts`
- `packages/evidence/src/evidence-publication-service.test.ts`
- `packages/evidence/src/index.ts`

## Remaining M10 Task 1 work

The next slice adds manifest-registered logcat input validation, bounded streaming redaction, source hash/truncation metadata, and redaction-failure blocking. Offline HTML, ZIP64, finalization retry, Results history, storage cleanup, and crash fixtures remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
