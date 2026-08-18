# M10 Task 5: Storage Pressure Poller Acceptance

## Scope

This atomic slice adds explicit lifecycle management around `StoragePressureMonitor`. It samples immediately on `start()`, schedules recurring samples through an injectable scheduler, prevents overlapping reads, and waits for in-flight work during `stop()`. It does not wire the poller into the server, persist incidents, gate Run/video creation, or add UI.

## Delivered

- Added `StoragePressurePoller` with `start()`, `stop()`, and `isRunning()` lifecycle APIs.
- Immediate startup sampling is shared by concurrent `start()` calls; repeated starts do not register duplicate intervals.
- Interval callbacks reuse the monitor's in-flight request so slow filesystem probes cannot overlap.
- Stopping clears the interval, prevents a pending startup from resurrecting it, and waits for in-flight sampling to settle.
- Injected scheduler, sample callback, and error callback keep the behavior deterministic and ready for later server wiring.
- Exported the poller through `@test-center/evidence`.

## Verification

- Storage pressure poller focused tests: 5/5 passed.
- Full suite: 119 files, 480 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Server startup/shutdown integration and persisted pressure incidents.
- Transactional Run/video creation gates and storage cleanup actions.
- Retention candidates, protected-run cleanup, trash recovery, and cleanup audit manifests.
- Overview/Settings storage UI.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
