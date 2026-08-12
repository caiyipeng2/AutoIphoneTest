# M8 Multi-Device Deployment Design

## Goal

Extend artifact deployment from one Android serial to a selected set of one to four unique online devices while preserving the existing single-device API and keeping per-device state, identity verification, and failures isolated.

## Scope

- `POST /api/deployments` accepts `deviceSerials` with 1-4 unique serials; legacy `deviceSerial` remains accepted for one-device callers.
- A deployment is one logical task with one `deployment_devices` row and one state machine per selected serial.
- APK/AAB install, optional data mutation, identity verification, and launch run independently per serial with bounded concurrency of four.
- A failed device becomes `FAILED` without overwriting successful or still-running devices. The aggregate view is `COMPLETED` only when all selected devices complete, `CANCELLED` only when every device is cancelled, and `FAILED` when at least one device fails and no device remains active.
- Idempotency compares artifact, ordered unique serial set, and mutation. A request-id reuse with a different set is rejected.
- Destructive confirmation is consumed once per selected serial using the same operation/artifact/session binding; missing or mismatched confirmation blocks creation before any row is inserted.
- This slice does not add AAB split-set generation, port/worker isolation, UI deployment controls, or four-device soak testing; those remain later M8 tasks.

## API shape

```ts
type DeploymentCreateInput = {
  clientRequestId: string;
  artifactId: string;
  deviceSerial?: DeviceSerial;      // legacy one-device form
  deviceSerials?: DeviceSerial[];  // preferred 1-4 form
  mutation?: "NONE" | "CLEAR_DATA" | "UNINSTALL_REINSTALL";
  confirmationNonce?: string;
  sessionId?: string;
};
```

The response retains `deviceSerial` for compatibility and adds `deviceSerials` plus `devices`, where each entry exposes serial, state, current step, failed step, and failure message. Existing clients can continue reading the leader/single target fields.

## Execution and persistence

Creation validates all serials before opening the insert transaction: printable/unique, online, not actively deployed, and artifact signer valid. The transaction inserts the aggregate row and all target rows atomically.

`run(id)` snapshots all target rows, runs each non-terminal target through the existing `DeploymentMachine` in a `Promise.all` group, and publishes after every target transition. Each target uses `DeploymentRepository(database, id, serial)`, so `deployment_steps` and mutation records retain serial ownership. The aggregate row is refreshed from target states after each transition.

Target execution keeps the current step ordering and identity comparison. A target exception dispatches `FAIL` only on that target; other targets continue. Retry reruns only failed targets from their failed step. Cancellation is allowed before install for all non-terminal targets and does not alter completed targets.

## Error handling

- Empty, duplicate, offline, over-capacity, occupied, or mixed legacy/new serial input returns a deterministic 400/409 error.
- No device action starts when group validation or confirmation fails.
- Device-level failure messages are persisted under that serial and returned in `devices`; aggregate failure is derived, never used to erase target detail.
- Existing auth, origin, CSRF, and idempotency protections remain unchanged.

## Verification

- Unit tests cover capacities 1/2/3/4, duplicate and five-device rejection, atomic creation, idempotency by ordered serial set, independent failure, retry of failed serials, and legacy one-device compatibility.
- Route tests cover `deviceSerials` parsing and returned per-device view.
- Full Vitest, Console/server typecheck, targeted ESLint, Prettier, and build checks run before local acceptance.

