# M6 Task 5: Session Action Dispatch Acceptance

## Scope

This slice closes the confirmed single-device action path:

1. A running session accepts a tap or swipe through `POST /api/sessions/:id/actions`.
2. The action is persisted with an idempotency key and an outbox row.
3. The dispatcher leases the outbox row, executes the action through Appium, and fences the lease token.
4. The target result is written to `device_action_results`; the action becomes `SUCCEEDED` or `FAILED` only after all target rows finish.
5. A successful action acknowledges the outbox row.

The dispatcher iterates every active or recovering target snapshot, so the persistence boundary is already compatible with one to four connected devices. The current session creation API intentionally creates one leader target; adding follower selection remains a later slice.

## Automated verification

- `npx vitest run packages/sessions/src/run-repository.test.ts apps/server/src/session-runtime.test.ts apps/server/src/routes/sessions.test.ts`
  - 12 tests passed.
- `npm run typecheck -- --pretty false`
  - passed.
- Targeted ESLint and Prettier checks passed.

## True hardware verification

Prerequisites used:

- Android serial: `R5CX211TXNT` (`SM-S9280`), state `device`.
- Appium: `http://127.0.0.1:4723`, version `3.6.0`, ready.
- Installed package: `com.hg.idleweaponshoptycoon.android` (Idle Weapon Shop Tycoon).

Command:

```powershell
npm run typecheck -- --pretty false
node scripts/accept-m6-session-action.mjs
```

Evidence:

- `data/runs/m6-session-action-1786439300515/acceptance.json`
- Session: `run-69675a64-8be0-43c4-a662-040a7a91ad12`
- Action: `act-3d6b9700-62fb-4f83-a228-ccd6d49a87b5`
- Device result: `SUCCEEDED`
- Action state: `SUCCEEDED`
- Outbox state: `ACKED`, attempt count `1`
- Appium result: foreground package matched and `3` pointer actions executed.

## Approval gate

This slice is verified locally and on the connected Android device. The source changes and acceptance document remain uncommitted until explicit approval; after approval they can be staged, committed, and pushed to `main`.
