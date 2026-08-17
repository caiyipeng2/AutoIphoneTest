# M10 Task 3 - Evidence ZIP verifier acceptance

## Scope

This atomic slice reopens a published ZIP64 archive and independently verifies its manifest and physical entries. It does not yet couple verification to `ReportExportRepository` or finalization state transitions.

## Delivered behavior

- Adds explicit `yauzl` `3.4.0` and `@types/yauzl` `3.4.0` dependencies with minimal lockfile changes.
- Opens ZIP64 with strict filenames and entry-size validation, and reads entries lazily.
- Buffers only the bounded `manifest.json` (4 MiB maximum); evidence entries are hashed and sized from decompressed streams without whole-file buffering.
- Rejects missing/duplicate/unknown entries, missing manifest, invalid manifest JSON, manifest mismatch, and SHA-256 or byte-size mismatch.
- Verifies the archive path remains inside the configured run root before opening it.
- Returns a deterministic list of verified physical entries and their measured metadata.

## Verification evidence

- `npm test -- --run packages/reports/src/evidence-zip-verifier.test.ts`: 3/3 passed.
- `npm run typecheck`: passed.
- `npm run lint -- --fix=false`: passed.
- `npm test -- --run packages/reports`: 9 files, 31 tests passed.
- `npm test`: 106 files, 426 tests passed.
- Prettier check for changed verifier/report files: passed.
- `git diff --check`: passed.
- `codegraph sync`: passed; 3 changed files indexed.
- `npm install --package-lock-only --ignore-scripts --offline --dry-run`: lockfile accepted without unrelated rewrites.

## Not included in this slice

- Automatic `READY`/`FAILED` transition in `ReportExportRepository` after verification.
- Finalization retry/reconciliation and results history API/UI.
- Large-file or crash-injection integration fixtures.

## Approval gate

Implementation is complete and remains uncommitted. Commit and push only after user acceptance of this atomic slice.
