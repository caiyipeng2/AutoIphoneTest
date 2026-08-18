# M10 Task 5: Windows Free-Space Adapter Acceptance

## Scope

This atomic slice connects the storage monitor to Node's Windows `statfs` API through an injectable adapter. It only reads filesystem statistics; it does not schedule polling, mutate files, write incidents, or gate run creation.

## Delivered

- Added `createFileSystemFreeSpaceSource` backed by `node:fs/promises.statfs`.
- Normalized and validated drive-qualified Windows paths; relative, POSIX, and UNC paths are rejected.
- Supports numeric and BigInt `bavail`/`bsize` values without mixed arithmetic.
- Rejects negative, malformed, and unsafe-overflow byte products by returning `undefined`, allowing the monitor to fail closed.
- Exported the adapter through `@test-center/evidence` for later server wiring.

## Verification

- Free-space adapter and monitor focused tests: 10/10 passed.
- Full suite: 118 files, 475 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Periodic server polling and lifecycle start/stop management.
- Transactional Run/video creation gates and persisted pressure incidents.
- Retention candidates, protected-run cleanup, trash recovery, and cleanup audit manifests.
- Overview/Settings storage UI.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
