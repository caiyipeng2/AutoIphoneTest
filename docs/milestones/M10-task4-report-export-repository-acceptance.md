# M10 Task 4 - Report export repository acceptance

## Scope

This slice adds the durable state repository for HTML and ZIP report export
attempts. It does not write files, finalize runs, or implement retry APIs.

## Acceptance behavior

- Supports `HTML` and `ZIP` export formats with `PENDING`, `READY`, `FAILED`,
  and `MISSING` states.
- Creation is idempotent for the same export identity and rejects an existing
  id with different run, format, path, or attempt data.
- Pending exports can be listed per run in deterministic creation order.
- READY persists a validated relative path, lowercase SHA-256, and non-negative
  byte size.
- FAILED and MISSING persist explicit error categories and cannot transition a
  terminal record again.
- Optional `runRoot` validation rejects absolute or traversal paths before they
  reach the database.
- Repository state transitions are independent from file I/O so the later
  atomic publisher can own publication failures.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports` passed: 5 files, 14 tests.
- `npm test` passed: 102 files, 409 tests.
- Prettier check passed for all report files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the export repository.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
