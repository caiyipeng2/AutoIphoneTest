# M10 Task 2 - Immutable report model acceptance

## Scope

This slice adds the pure in-memory report snapshot boundary. It does not query
SQLite, render HTML, or add report finalization behavior.

## Acceptance behavior

- Only terminal report states `FINISHED`, `FAILED`, and `INTERRUPTED` are
  accepted; live states are rejected.
- Run, device, action, target, and evidence values are copied into a new
  snapshot, so later input mutations cannot alter the report model.
- Devices sort by serial, actions by `actionSeq` then id, targets by serial,
  and evidence by id for deterministic output.
- Device serials and evidence links use the existing validation primitives.
- Duplicate device/action/target/evidence identities are rejected.
- READY evidence requires publication path and SHA-256 metadata; MISSING
  evidence requires an explicit unavailable reason.
- The model and every nested object/array are recursively frozen.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports` passed: 2 files, 6 tests.
- `npm test` passed: 99 files, 401 tests.
- Prettier check passed for all files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the model implementation.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
