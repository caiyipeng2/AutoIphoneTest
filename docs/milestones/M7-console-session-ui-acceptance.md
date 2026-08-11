# M7 Console Session UI Acceptance

## Scope

This slice wires the existing Console session page to the multi-device session API and exposes the 1-4 device selection flow for the Unity Android package `com.hg.idleweaponshoptycoon.android`.

## User-visible result

- The session page loads online ADB devices and lets the operator select between 1 and 4 devices.
- The first selected device is shown as `LEADER`; remaining selected devices are `FOLLOWER` candidates.
- The operator can edit the package name, create a session, run preflight, and start the session from one action.
- The session panel shows bound devices, membership state, and the active leader preview target.
- The overview page's `新建测试会话` action navigates to the session page.
- On narrow screens the device/configuration panels collapse to one column without horizontal overflow.

## Verification evidence

| Check                                                         | Result                      |
| ------------------------------------------------------------- | --------------------------- |
| `npx vitest run apps/console/src/pages/SessionsPage.test.tsx` | 2 tests passed              |
| `npm test`                                                    | 72 files / 275 tests passed |
| `npx tsc --build apps/console/tsconfig.json --pretty false`   | passed                      |
| `npm run build --workspace @test-center/console`              | passed                      |
| targeted ESLint for changed Console files                     | passed                      |
| targeted Prettier check for changed Console files             | passed                      |
| browser navigation from overview to `#sessions`               | passed                      |
| browser desktop and 375x820 mobile viewport inspection        | passed                      |

## Runtime note

The local Fastify service recognized the currently connected Android device in the overview snapshot (`SM-S9280`, 1 of 4). The browser session-page API request returned HTTP 401 after the one-time bootstrap exchange was consumed during repeated navigation, so this slice's real-device session creation remains covered by the mocked two-device UI test and the previously accepted backend multi-device evidence. No device state was changed by this UI acceptance.

## Approval boundary

The four Console source files and this acceptance record remain uncommitted until the user explicitly approves the slice. After approval, stage, commit, and push will be performed separately.
