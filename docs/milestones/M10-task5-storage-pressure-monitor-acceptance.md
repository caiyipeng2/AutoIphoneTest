# M10 Task 5: Storage Pressure Monitor Acceptance

## Scope

This atomic slice adds an injectable storage monitor. Callers provide a free-space source, record completed writes, and explicitly request a sample. No background timer, filesystem mutation, database incident write, or UI integration is included.

## Delivered

- Added `StoragePressureMonitor` with an injectable `StorageFreeSpaceSource`.
- Samples preserve the measured timestamp, free bytes, policy pressure, and latest rolling write rate in bytes per second.
- The default rolling window is five minutes and is configurable for deterministic tests.
- Probe exceptions and invalid readings fail closed as `BLOCKED` with `FREE_SPACE_UNAVAILABLE`.
- Old write events are pruned from the rolling window; future-dated events remain available for a later sample.
- Exposed the monitor through `@test-center/evidence`.

## Verification

- Storage monitor and policy focused tests: 16/16 passed.
- Full suite: 117 files, 469 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- A real Windows `statfs` adapter and periodic server scheduler.
- Transactional Run/video creation gates and persisted pressure incidents.
- Retention candidates, protected-run cleanup, trash recovery, and cleanup audit manifests.
- Overview/Settings storage UI.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
