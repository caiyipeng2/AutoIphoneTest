# M10 Task 2 - Incident and recovery report snapshot acceptance

## Scope

This slice extends the SQLite report snapshot and offline HTML model with
incident and recovery information. It does not add finalization, ZIP export, or
Results API behavior.

## Acceptance behavior

- Incident records are loaded with category, device/generation, realtime and
  wall-clock timestamps, source, evidence reference, and string details.
- Recovery attempts are loaded with action, target, reason, deadline, status,
  completion, and error fields.
- Incident ordering is deterministic by realtime timestamp, wall-clock time,
  then incident id; recovery ordering is by start time then id.
- Incident detail keys are normalized lexicographically and all incident /
  recovery structures are recursively frozen with the report model.
- Offline HTML includes separate Incident log and Recovery attempts sections,
  while preserving escaping and no-network CSP guarantees.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports` passed: 4 files, 11 tests.
- `npm test` passed: 101 files, 406 tests.
- Prettier check passed for all report files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the extension.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
