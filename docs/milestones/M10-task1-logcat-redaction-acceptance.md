# M10 Task 1: Manifest-Bound Logcat Redaction

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice adds bounded, manifest-bound logcat redaction. The reader resolves only a registered `logcat-segment` evidence ID, requires an exact serial match, validates the relative path under the run root, validates the requested monotonic time window against manifest metadata, and streams the source while recomputing its byte size and SHA-256. Any source change or manifest mismatch rejects the operation before a redacted result can be published.

Threadtime prefixes (timestamp, pid/tid, level, and tag) are preserved. Configured secrets, action text and escaped forms, bearer/authorization/token/cookie/CSRF/bootstrap/keystore-password patterns are replaced before output. Output is bounded by bytes and line count, records truncation, and continues draining the source so the source hash remains authoritative.

## Verification evidence

| Check                             | Result                                    |
| --------------------------------- | ----------------------------------------- |
| TDD red run before implementation | PASS: missing `logcat-evidence.js` module |
| Logcat redaction tests            | PASS, 3 tests                             |
| Evidence package tests            | PASS, 7 files / 24 tests                  |
| Full Vitest suite                 | PASS, 96 files / 392 tests                |
| TypeScript build                  | PASS                                      |
| ESLint                            | PASS                                      |
| Prettier check                    | PASS                                      |
| `git diff --check`                | PASS                                      |

## Files

- `packages/evidence/src/logcat-evidence.ts`
- `packages/evidence/src/logcat-evidence.test.ts`
- `packages/evidence/src/index.ts`

## Remaining M10 Task 1 work

The redacted result is not yet automatically published through `EvidencePublicationService`; that integration is the next approval-gated slice. Offline HTML, ZIP64, finalization retry, Results history, storage cleanup, and crash fixtures remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
