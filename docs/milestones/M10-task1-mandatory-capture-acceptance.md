# M10 Task 1: Mandatory Capture Matrix

Date: 2026-08-14  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Scope

This slice adds the pure mandatory-capture evaluator planned by M10 Task 1. It does not publish files, change SQLite state, redact logcat, or finalize a run.

The evaluator applies these rules:

- A connected failure requires the current screenshot, foreground-process result, redacted logcat, mapped input, and Appium timing.
- A connected failure with a ready Unity QA Bridge additionally requires bridge state, arm, and ACK evidence.
- A disconnected failure requires buffered logcat and mapped input. Live captures may be explicitly unavailable only with `DEVICE_DISCONNECTED`, `PROCESS_ABSENT`, or `SOURCE_NOT_APPLICABLE`.
- `MISSING`, `FAILED`, and generic `UNAVAILABLE` captures fail the gate; the evaluator never turns a generic capture error into an accepted absence.

## Verification evidence

| Check                             | Result                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| TDD red run before implementation | PASS: module-not-found failure for `mandatory-capture.js`                                                      |
| Mandatory-capture tests           | PASS, 6 tests                                                                                                  |
| Evidence package tests            | PASS, 3 files / 11 tests                                                                                       |
| Full Vitest suite                 | PASS, 91 files / 376 tests                                                                                     |
| TypeScript build                  | PASS                                                                                                           |
| ESLint                            | PASS                                                                                                           |
| New-file Prettier check           | PASS                                                                                                           |
| `git diff --check`                | PASS                                                                                                           |
| Full-repository Prettier check    | BLOCKED by existing generated Unity files and pre-existing source/docs formatting; no new-file failure remains |

## Files

- `packages/evidence/src/mandatory-capture.ts`
- `packages/evidence/src/mandatory-capture.test.ts`
- `packages/evidence/src/index.ts`

## Remaining M10 Task 1 work

The next approval-gated slice is the crash-safe evidence publisher and migration `0009_evidence_reports.sql`. Logcat redaction, evidence repository persistence, report exports, finalization recovery, Results history, storage cleanup, and M10 fixture/crash acceptance remain unimplemented.

This slice is intentionally uncommitted and unpushed pending user confirmation.
