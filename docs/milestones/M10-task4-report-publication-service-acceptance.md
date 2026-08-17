# M10 Task 4 - Report HTML publication service acceptance

## Scope

This slice connects a pending `report_exports` row to the existing atomic file publisher. It covers HTML publication only as the first executable path; the repository still retains the `ZIP` format for the later archive slice.

## Delivered behavior

- `ReportPublicationService` loads one export attempt and rejects missing, terminal, or mismatched-attempt records before touching the filesystem.
- `AtomicEvidencePublisher` writes the HTML stream to a same-directory partial file, computes SHA-256 and byte size, then atomically renames it to the final relative path.
- Successful publication transitions the export to `READY` using measured path, hash, and size metadata.
- Publisher or renderer failures transition the export to `FAILED` with `PUBLISH_FAILED`, rethrow the original error, and remove the partial file.
- The reports package now depends on `@test-center/evidence`; TypeScript project references, Vitest source aliasing, and `package-lock.json` are synchronized.

## Verification evidence

- `npm test -- --run packages/reports/src/report-publication-service.test.ts`: 3/3 passed.
- `npm run typecheck`: passed.
- `npm run lint -- --fix=false`: passed.
- `npm test -- --run packages/reports`: 6 files, 17 tests passed.
- `npm test`: 103 files, 412 tests passed.
- Prettier check for all changed source/config files: passed.
- `git diff --check`: passed.
- `codegraph sync`: passed; 4 changed files indexed.

## Not included in this slice

- ZIP archive creation, ZIP64 limits, and archive manifest composition.
- A finalization/orchestration service that renders a snapshot and creates both HTML and ZIP exports.
- Reconciliation of stale `PENDING` rows after process restart.

## Approval gate

Implementation is complete and remains uncommitted. Commit and push only after user acceptance of this atomic slice.
