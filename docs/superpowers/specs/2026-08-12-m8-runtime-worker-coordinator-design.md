# M8 Runtime Worker Coordinator Design

## Goal

Connect the managed `DeviceWorker` lifecycle to the server session start path for one to four Android devices.

## Boundaries

- `RuntimeWorkerCoordinator` owns workers by `runId` and starts all session members concurrently.
- A worker start failure stops every worker created for that run and leaves the session in `PREFLIGHT`.
- `RuntimeSessionRouteService.start()` commits `RUNNING` only after all workers are ready.
- Production assembly uses `WorkerResourceManager`, `AppiumService`, `AppiumW3cClient`, and `LogcatStream` with project-local paths.
- Runtime close stops every active run before closing the database.

## Runtime resource defaults

- ADB path: `TEST_CENTER_ADB_PATH` or the Unity Android SDK platform-tools path.
- Appium launch: `TEST_CENTER_APPIUM_NODE` overrides the Node executable and defaults to the server's `process.execPath`; `TEST_CENTER_APPIUM_ENTRY` overrides the Appium JS entry and defaults to `node_modules/appium/build/lib/main.js`. Windows does not spawn the `.cmd` shim, avoiding `spawn EINVAL` with `shell:false`.
- Appium home: `TEST_CENTER_APPIUM_HOME` or `<dataRoot>/appium-home`.
- Appium ports: `4723-4726`; system ports `8200-8203`; MJPEG ports `7810-7813`; bridge ports `17501-17504`.
- Worker paths are created below the existing `runsRoot` and are owned by the resource lease.

## Verification

- Coordinator tests cover 1-4 concurrent starts, complete rollback on partial failure, and stop cleanup.
- Session runtime tests cover the `PREFLIGHT -> RUNNING` gate and failure preservation.
- Production assembly remains injectable through the coordinator factory; real Appium/ADB is a separate hardware acceptance step.
