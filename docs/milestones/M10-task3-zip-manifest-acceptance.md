# M10 Task 3 - ZIP evidence manifest acceptance

## Scope

This atomic slice defines the deterministic manifest contract used by the later ZIP64 publisher. It does not add an archive library or write ZIP bytes.

## Delivered behavior

- `createZipManifest` includes the HTML report and only `READY` evidence as physical archive entries.
- Every included entry carries canonical forward-slash path, type, association ID, SHA-256, and byte size; evidence also carries kind and optional device serial.
- `PENDING`, `FAILED`, and `MISSING` evidence is represented in `unavailable` metadata without claiming a nonexistent file entry.
- Absolute paths, traversal segments, empty paths, invalid hashes, invalid sizes, and missing READY metadata are rejected.
- Duplicate and case-insensitive path collisions are rejected before archive creation.
- Entries and unavailable records are sorted deterministically; `serializeZipManifest` uses recursively sorted keys for reproducible manifest bytes.

## Verification evidence

- `npm test -- --run packages/reports/src/zip-manifest.test.ts`: 7/7 passed.
- `npm run typecheck`: passed.
- `npm run lint -- --fix=false`: passed.
- `npm test -- --run packages/reports`: 7 files, 24 tests passed.
- `npm test`: 104 files, 419 tests passed.
- Prettier check for the changed report files: passed.
- `git diff --check`: passed.
- `codegraph sync`: passed; 3 changed files indexed.

## Not included in this slice

- Archiver dependency or ZIP64 byte generation.
- Streaming file entry publication, final ZIP hashing, atomic rename, and independent extraction verification.
- Finalization service orchestration and results history UI.

## Approval gate

Implementation is complete and remains uncommitted. Commit and push only after user acceptance of this atomic slice.
