# M10 Task 5: Storage Pressure Policy Acceptance

## Scope

This atomic slice defines the pure storage-pressure decision used by later run, video, evidence, and cleanup services. It does not read the filesystem, write SQLite incidents, delete files, or change the Console UI.

## Delivered

- Added `StoragePolicy` with the existing E-drive thresholds: warning at 20 GiB and danger at 5 GiB.
- Classifies free space as `NORMAL`, `WARNING`, or `BLOCKED`; exact 20 GiB is normal and exact 5 GiB is warning.
- Treats an unknown or invalid free-space reading as `BLOCKED` so new data creation fails closed.
- Blocks `START_RUN` and `START_VIDEO` below the danger threshold.
- Allows `ACTION_WRITE`, `EVIDENCE_WRITE`, and `REPORT_WRITE` to continue under pressure while returning a structured `STORAGE_PRESSURE` incident.
- Validates threshold ordering and positive safe-integer values.

## Verification

- Storage policy focused tests: 12/12 passed.
- Full suite: 116 files, 465 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Filesystem free-space polling and recent-write-rate sampling.
- Transactional run/video creation gates and persisted pressure incidents.
- Retention candidate queries, protected-run cleanup, trash recovery, and cleanup audit manifests.
- Overview/Settings storage UI.

## Approval gate

Implementation and local verification are complete after the stated checks. The current changes remain uncommitted and unpushed until explicit user approval.
