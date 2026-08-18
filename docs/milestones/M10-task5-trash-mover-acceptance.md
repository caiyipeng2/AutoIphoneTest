# M10 Task 5: Same-Volume Trash Mover Acceptance

## Scope

This atomic slice adds a path-safe mover for selected run directories. It validates same-volume, non-overlapping Windows roots and safe single-segment IDs, moves runs under `trash/<cleanupId>`, and rolls back completed moves when a later rename fails. It does not change SQLite state, delete files, or write an audit manifest.

## Delivered

- Added `CleanupTrashMover` with injectable filesystem operations for deterministic tests.
- Sorts selected Run IDs before building source and trash paths.
- Rejects traversal segments, duplicate IDs, cross-volume roots, and overlapping run/trash roots before filesystem mutation.
- Creates one cleanup-specific trash directory and moves each selected run directory with `rename`.
- On partial failure, rolls back completed moves in reverse order; rollback failures are surfaced as a distinct error.
- Exported the mover through `@test-center/evidence` for later cleanup orchestration.

## Verification

- Trash mover focused tests: 3/3 passed.
- Full suite: 122 files, 489 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- `DELETING` database state transitions and per-item cleanup metadata.
- Physical deletion inside the trash directory and append-only audit manifests.
- Recovery UI, server routes, and unresolved-path reporting.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
