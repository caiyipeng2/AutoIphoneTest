# M10 Task 2 - SQLite report snapshot repository acceptance

## Scope

This slice reads the authoritative SQLite run snapshot into the immutable
report model. It does not finalize runs, publish HTML/ZIP files, or expose an
HTTP endpoint.

## Acceptance behavior

- Reads the requested run identity, package, terminal state, epoch, and
  timestamps from `test_runs`.
- Reads only the requested epoch's `run_devices` membership and generation.
- Resolves each member's latest UID observation for the run package, ordered by
  observation time and row id.
- Reads actions and their device targets for the run, then delegates sorting,
  duplicate checks, terminal-state checks, and deep freezing to the immutable
  model.
- Reads all evidence records with publication metadata, failure categories, and
  explicit unavailable reasons.
- Uses one SQLite read transaction and rejects unknown runs or live run states
  before rendering.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports` passed: 4 files, 11 tests.
- `npm test` passed: 101 files, 406 tests.
- Prettier check passed for all report files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the snapshot repository.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
