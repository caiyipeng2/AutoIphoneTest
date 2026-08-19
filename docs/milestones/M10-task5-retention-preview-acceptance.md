# M10 Task 5: Retention Preview Acceptance

## Scope

This atomic slice exposes a read-only retention preview backed by the runtime SQLite database. It selects runs older than the requested retention window, excludes protected and non-terminal runs, and estimates only ready evidence and report bytes. Preview never deletes files, mutates cleanup state, issues confirmation nonces, moves data to trash, or consumes a confirmation.

## Delivered

- Added `CleanupService.preview` with a validated retention window of 1 to 3650 days.
- Added migration `0018_cleanup_protection` with a durable `test_runs.cleanup_protected` flag.
- Added `CleanupPreviewRepository`, which joins runs with finalization, evidence, and report tables and sums only `READY` byte counts. Imported artifacts are not part of this estimate.
- Terminal candidates include finished, completed, failed, interrupted, finalization-failed, and aborted states; running, paused, created, preflight, and finalizing records are excluded.
- Protected runs are excluded without changing the input records.
- Candidates are ordered deterministically by completion time and run ID, with a total estimate for the later confirmation flow.
- Added authenticated `GET /api/cleanup/preview?retentionDays=N`, returning `schemaVersion`, the normalized retention window, cutoff time, candidates, and total estimated bytes.
- Wired the runtime service to the database adapter and exported it through `@test-center/evidence`.

## Verification

- Retention preview repository and cleanup route focused tests: 4/4 passed.
- Full suite: 126 files, 502 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` passed.

## Not included in this slice

- Settings-table persistence or a UI control for changing the default retention window; the route defaults to 14 days and accepts an explicit query value.
- Confirmation nonce binding, `DELETING` state transitions, same-volume trash moves, audited deletion, and partial-failure recovery.
- UI overview/settings integration and real-device cleanup execution.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
