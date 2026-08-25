# BuildProvider extension

Build providers implement the existing `BuildProvider` contract and emit ordered progress events for validation, build, artifact publication, and completion. Providers must support cancellation, preserve immutable artifact hashes, and surface typed failures without mutating an existing artifact. Add unit coverage for success, cancellation, duplicate content, and provider failure before registration.

## Providers currently available

- `artifact-import` is the default provider used by the Apps page. It imports an existing APK/AAB and publishes it through the immutable artifact repository.
- `unity-command` is an opt-in provider for a configured Unity batch build. It invokes an absolute Unity executable with an argument array and then delegates the generated APK/AAB to `artifact-import`; it is not selected by the default import route until a project-specific command configuration is supplied.

`unity-command` requires an absolute executable path, an existing Unity project directory, an existing artifact import directory, and an output path below that import directory. The command executor uses `spawn(..., { shell: false })`; callers provide arguments as an array or an argument-builder function, so paths are never interpolated into a shell command. The provider emits `validate -> build -> hash -> parse -> publish` using one build ID, and `cancel(buildId)` aborts the Unity process and delegates cancellation to the import provider when publication has started.

The provider intentionally does not guess a project's Unity static build method, output layout, signing profile, or Unity version. Those values belong in the host's explicit `args` builder and project-local configuration. A concrete game project must still supply that configuration and pass a real-device package acceptance before it can be treated as the default build workflow.

## Provider discovery API

Authenticated clients can call `GET /api/artifacts/providers` to discover the provider IDs exposed by the current server. The response contains only `{ id, default }` descriptors and a schema version; executable paths, argument builders, signing data, and artifact storage paths are never returned. The default `artifact-import` provider remains available even when no optional provider is configured.
