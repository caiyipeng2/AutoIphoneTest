# M10 Task 1 - Redacted logcat publication acceptance

## Scope

This slice connects manifest-verified logcat redaction to the durable evidence
state machine. The raw logcat segment is read and validated first; only the
redacted string is handed to `EvidencePublicationService` and the atomic
publisher.

## Acceptance behavior

- Successful redaction and atomic publication mark the report-owned
  `REDACTED_LOGCAT` evidence record `READY` with measured path, SHA-256, and
  byte size.
- Manifest/source/serial/range validation failures mark the pending output
  record `FAILED` with `REDACTION_FAILED` and do not create an output file.
- Atomic publisher failures remain owned by the shared publication service and
  mark the output record `FAILED` with `PUBLISH_FAILED`.
- The report-owned output is checked to contain redaction markers and not the
  configured secret or action text. The raw source remains outside the report
  output path.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/evidence` passed: 8 files, 27 tests.
- `npm test` passed: 97 files, 395 tests.
- Prettier check passed for all files in this slice.
- `git diff --check` passed.

The repository-wide `npm run format:check` still reports pre-existing
formatting warnings in unrelated console, server, test, and Unity-generated
files; no warning was reported for this slice.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
