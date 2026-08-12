# M8 Multi-Device Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a bounded 1-4 device deployment API and per-device execution/results without breaking single-device callers.

**Architecture:** Keep one logical deployment row and one `DeploymentMachine`/`DeploymentRepository` per selected serial. Validate the complete serial set before one atomic insert, execute target machines concurrently, and derive aggregate state from target rows while preserving serial-scoped failures and steps.

**Tech Stack:** TypeScript, Fastify, Zod, SQLite/better-sqlite3, Vitest.

---

### Task 1: Define the multi-device deployment view and route input

**Files:**
- Modify: `packages/deployments/src/deployment-orchestrator.ts`
- Modify: `apps/server/src/routes/deployments.ts`
- Test: `packages/deployments/src/multi-device-deployment.test.ts`
- Test: `apps/server/src/routes/deployments.test.ts`

- [ ] Write failing tests for 1-4 serial creation, legacy single serial compatibility, duplicate/five-device rejection, and returned `devices` detail.
- [ ] Run `npx vitest run packages/deployments/src/multi-device-deployment.test.ts apps/server/src/routes/deployments.test.ts` and confirm the new capacity assertions fail because the current input/view is single-device only.
- [ ] Add `deviceSerials` normalization, `DeploymentDeviceView`, and compatible `DeploymentView` fields. Make route Zod validation accept either exactly one legacy `deviceSerial` or a 1-4 `deviceSerials` array, never both.
- [ ] Re-run the focused tests and confirm creation/validation assertions pass.

### Task 2: Create all target rows atomically and derive the aggregate view

**Files:**
- Modify: `packages/deployments/src/deployment-orchestrator.ts`
- Modify: `packages/deployments/src/deployment-repository.ts`
- Test: `packages/deployments/src/multi-device-deployment.test.ts`

- [ ] Add a test proving a four-device create inserts four target rows and a validation failure inserts none.
- [ ] Implement sorted/idempotent serial comparison, serial occupancy checks, and one transaction inserting the aggregate plus all target rows.
- [ ] Make `get(id)` return target details and aggregate state derived from target rows; retain the legacy first serial field.
- [ ] Run focused deployment tests.

### Task 3: Execute target machines independently

**Files:**
- Modify: `packages/deployments/src/deployment-orchestrator.ts`
- Modify: `packages/deployments/src/deployment-repository.ts`
- Test: `packages/deployments/src/multi-device-deployment.test.ts`

- [ ] Add a test where one target fails identity verification while the other targets complete, and assert independent install/launch logs and persisted failure detail.
- [ ] Implement per-serial `runTarget` using the existing step machine and run all non-terminal targets with `Promise.all`.
- [ ] Add tests for retrying only failed targets and cancelling active targets without changing completed targets.
- [ ] Run focused deployment and route tests.

### Task 4: Verify the repository and local acceptance

**Files:**
- Modify: `docs/milestones/M8-multi-device-deployment-acceptance.md`

- [ ] Run `npm test`, `npx tsc --build --pretty false`, `npm run build --workspace @test-center/console`, targeted ESLint, and targeted Prettier.
- [ ] Run CodeGraph sync and `git diff --check`.
- [ ] Record exact test counts, API compatibility, and the known limitation that AAB install-set specialization and four-device hardware soak remain later M8 tasks.
- [ ] Wait for user approval before staging, committing, and pushing.

