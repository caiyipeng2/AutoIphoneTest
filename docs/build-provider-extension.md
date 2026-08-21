# BuildProvider extension

Build providers implement the existing `BuildProvider` contract and emit ordered progress events for validation, build, artifact publication, and completion. Providers must support cancellation, preserve immutable artifact hashes, and surface typed failures without mutating an existing artifact. Add unit coverage for success, cancellation, duplicate content, and provider failure before registration.
