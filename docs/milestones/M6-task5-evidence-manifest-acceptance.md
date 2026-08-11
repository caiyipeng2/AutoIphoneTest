# M6 Task 5 Evidence Manifest Acceptance

Date: 2026-08-11
Scope: the first Task 5 atomic slice only: a run-local, hashed evidence index.

## Delivered

- Added `@test-center/evidence` with `EvidenceManifestStore`.
- Evidence entries are SHA-256 hashed from the bytes on disk and record size, kind, serial, capture time, relative path, and bounded metadata.
- Relative paths are normalized and rejected when they escape the run root.
- Re-registering the same evidence ID and identity is idempotent; a conflicting identity is rejected.
- Manifest writes use a unique `.partial` file, `fsync`, and rename to `evidence-manifest.json`; the partial file is not left behind after success.

## Verification

| Check | Result |
| --- | --- |
| Evidence manifest tests | 2/2 passed |
| Full Vitest | 67 files, 254 tests passed |
| `npm run typecheck` | Passed |
| Targeted Prettier | Passed |
| Targeted ESLint | Passed |
| CodeGraph sync | Added 3 files, modified 2 files; index up to date |

## Boundary

This slice does not yet register screenshots/logcat/timing from session routes, expose APIs, or modify the console UI. Those remain separate Task 5 slices and require independent acceptance.
