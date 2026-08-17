# M10 Task 3 - Report ZIP publication state acceptance

## Scope

This atomic slice connects ZIP publication and independent verification to `report_exports`. It is the first end-to-end ZIP path from a pending export row to a durable READY or FAILED state.

## Delivered behavior

- `ReportZipPublicationService` accepts only a pending `ZIP` export with the matching attempt number.
- Publisher failures transition the row to `FAILED/PUBLISH_FAILED` and preserve the original error.
- Successful publication is reopened and independently verified before any READY transition.
- Manifest/hash/size verification failures transition the row to `FAILED/VERIFY_FAILED`, remove the final rejected ZIP, and preserve the original error.
- Only a verified archive calls `ReportExportRepository.markReady`, recording the measured final path, archive SHA-256, and byte size.
- HTML exports, terminal rows, missing rows, and attempt mismatches are rejected before filesystem publication and remain PENDING when applicable.

## Verification evidence

- `npm test -- --run packages/reports/src/report-zip-publication-service.test.ts`: 3/3 passed.
- `npm run typecheck`: passed.
- `npm run lint -- --fix=false`: passed.
- `npm test -- --run packages/reports`: 10 files, 34 tests passed.
- `npm test`: 107 files, 429 tests passed.
- Prettier check for changed report files: passed.
- `git diff --check`: passed.
- `codegraph sync`: passed; 5 changed files indexed.
- `npm install --package-lock-only --ignore-scripts --offline --dry-run`: lockfile accepted without unrelated rewrites.

## Not included in this slice

- HTML and ZIP finalization orchestration in one run-level service.
- Retry/reconciliation of stale PENDING exports after process restart.
- Results history API, console UI, and crash-injection integration tests.

## Approval gate

Implementation is complete and remains uncommitted. Commit and push only after user acceptance of this atomic slice.
