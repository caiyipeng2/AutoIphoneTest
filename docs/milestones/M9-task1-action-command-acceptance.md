# M9 Task 1 动作命令策略验收

## 本切片范围

- 新增闭合 `ActionCommand` 联合：tap、long press、swipe、drag、Back、文本、activate、terminate、restart。
- 统一动作边界：长按 `300-10000ms`，路径 `2-128` 个点、时长 `50-30000ms`，文本 `1-2000` 个 Unicode scalar values。
- 固定 ACK 完成策略：输入类动作需要 bridge arm/ACK；activate/restart 等待 fresh bridge state；terminate 等待进程消失。
- 文本动作只产生长度和类别序列哈希描述，不在动作描述中保存明文，也不对短文本原文做可字典反推的内容哈希。
- long press 和 drag 已映射为严格的 W3C pointer 序列；drag 与 swipe 共用分段时长分配逻辑。

## 测试证据

| 检查                                 | 结果                       |
| ------------------------------------ | -------------------------- |
| 动作命令 focused tests               | 11 个测试通过              |
| Appium action focused tests          | 5 个测试通过               |
| Back action focused tests            | 6 个测试通过               |
| Activate action focused tests        | 7 个测试通过               |
| Terminate action focused tests       | 8 个测试通过               |
| Restart action focused tests         | 9 个测试通过               |
| Appium current_package null 回归测试 | 1 个测试通过               |
| TypeScript project build             | 通过                       |
| 本切片 ESLint                        | 通过                       |
| 本切片 Prettier                      | 通过                       |
| `git diff --check`                   | 通过                       |
| Android 真机 long press/drag         | Appium `/actions` HTTP 200 |

## M9 Task 2：命令持久化与 dispatcher 接入

- `actions.command_json` 通过 `0010_action_commands` 增量迁移保存规范化 `ActionCommand`；旧 `tap/swipe` 行仍可回读。
- session action schema 现在允许 `longPress`、`drag`、`text`、`back`、`activate`、`terminate`、`restart` 命令进入 repository/outbox/dispatcher。
- dispatcher 为每个目标传递同一条规范化命令；生命周期命令不伪造 pointer payload。

| 检查                                   | 结果          |
| -------------------------------------- | ------------- |
| repository / outbox 命令 focused tests | 14 个测试通过 |
| session runtime 命令闭环测试           | 7 个测试通过  |
| 数据库迁移测试                         | 4 个测试通过  |
| TypeScript project build               | 通过          |

当前边界：bridge arm/ACK、文本可信焦点屏障、故障 incident/policy 和控制台命令控件仍未接入；本次只完成 API 到持久化和 dispatcher 的命令传递闭环。

## M9 Task 3：输入动作 ARM/ACK barrier

- 新增可注入的 `ActionBarrier` 接口，输入类动作按 `ARM → Appium → ACK` 顺序完成。
- `activate`、`terminate`、`restart` 等 lifecycle 命令不会错误触发输入 arm。
- Appium 失败或 ACK 失败时自动取消 arm，并将目标结果记为失败。
- barrier 请求携带 action、设备 serial、规范化 command、metrics epoch 和可选 source frame；真实 BridgeClient/ADB forward 绑定留在 managed worker 接线切片。

| 检查                                    | 结果          |
| --------------------------------------- | ------------- |
| ARM/Appium/ACK 顺序与清理 focused tests | 12 个测试通过 |
| TypeScript project build                | 通过          |

当前边界：本切片完成 dispatcher barrier 契约和失败清理，尚未把真实 Unity QA Bridge 连接绑定到每个 managed worker，也未实现文本可信焦点屏障。

## M9 Task 4：managed worker Bridge 生命周期接线

- `DeviceWorker` 在 managed 资源租约中使用独立 bridge host port，建立 serial-owned ADB forward。
- worker 创建并连接注入的 Bridge session，向上暴露 generation-fenced `ActionBarrier`。
- worker 停止、启动回滚和 bridge 连接失败都会关闭 session、移除 forward，并释放 worker 资源。

| 检查                                                | 结果          |
| --------------------------------------------------- | ------------- |
| managed worker bridge forward/session focused tests | 11 个测试通过 |
| TypeScript project build                            | 通过          |

当前边界：dispatcher runtime factory 尚未绑定真实 `BridgeClient + ArmController`，run nonce、metrics/view/focus 映射和真实 Unity bridge action 验收留在下一切片；本切片只闭合 worker 生命周期与资源清理。

## M9 Task 5：runtime BridgeClient/ArmController 接入

- `RuntimeWorkerCoordinator.start` 将数据库中的 run nonce 传递到每个 managed worker；session 不对外暴露 nonce。
- runtime worker 使用独立的 ADB forward 创建 TCP `BridgeClient`，连接后执行时钟校准，并由 `ArmController` 生成带 run nonce、当前 view/focus/metrics 的 `QA_ARM`。
- `ActionDispatcher` 通过 runId/serial 取得 READY worker 的真实 `ActionBarrier`，形成 `ARM -> Appium -> QA_ACK` 生产接线。
- lifecycle 命令继续跳过 bridge arm；bridge session 连接失败、worker 停止和启动回滚沿用既有 forward/session 清理路径。

| 检查                                               | 结果                                                           |
| -------------------------------------------------- | -------------------------------------------------------------- |
| runtime bridge、coordinator、session focused tests | 34 个测试通过                                                  |
| TypeScript project build                           | 通过                                                           |
| Prettier 与 diff check                             | 通过                                                           |
| 已连接真机 Appium 前置检查                         | 未通过：Appium 3.6.0 在驱动加载阶段就绪超时，设备 ADB 状态正常 |

当前边界：生产游戏包是否包含 Unity QA Bridge 组件仍需用带 `UNITY_MULTI_DEVICE_QA` 的验收包确认；当前 `normalizedShape` 使用会话动作规范，需与游戏侧 `QaActionDescriptor` 约定一致后才能得到真实 QA_ACK。现有 `com.hg.idleweaponshoptycoon.android` 包未完成该 bridge 闭环验收。

## M9 Task 6：同步文本可信焦点 barrier

- 文本动作在 dispatcher 进入 Appium 前，要求所有目标设备两次采样均存在非空可信焦点。
- 两次采样必须保持各设备自己的 bridge instance、view、focused control 和 metrics epoch；不同设备允许拥有不同 bridge instance，但单设备重连/漂移会被拒绝。
- barrier 失败时整组目标均记录 `FAILED`，不发送 ARM、不调用 Appium，也不自动重试。
- runtime coordinator 从 READY worker 暴露 state snapshot，dispatcher 按真实 `runId + serial` 查询，避免使用占位 session 或跨运行数据。

| 检查                                              | 结果                      |
| ------------------------------------------------- | ------------------------- |
| 文本焦点 barrier、失败矩阵、dispatcher 不发送动作 | 21 个 focused 测试通过    |
| 全量自动化测试                                    | 78 个文件、329 个测试通过 |
| TypeScript project build                          | 通过                      |
| 本切片文件级 ESLint、Prettier、diff check         | 通过                      |

当前边界：文本明文默认脱敏、故障 incident/policy、控制台动作/故障 UI 和 M10 默认 HTML/ZIP 报告仍未实现；生产游戏包也仍需启用 Unity QA Bridge 后才能进行真实文本 QA_ACK 验收。

## M9 Task 7：默认文本脱敏基础层

- 新增 `TextRedactor`，默认只输出 `masked=true`、Unicode code point 长度、类别摘要和 run-salted SHA-256。
- `redact` 同时替换日志中的精确明文和 JSON 字符串形式，避免诊断文本直接泄漏测试输入。
- 空文本和过短 run salt 被拒绝；该层不改变现有动作持久化 schema，后续 evidence/report 发布器将复用同一契约。

| 检查                                | 结果                      |
| ----------------------------------- | ------------------------- |
| text redactor focused tests         | 3 个测试通过              |
| 全量自动化测试                      | 79 个文件、332 个测试通过 |
| TypeScript project build            | 通过                      |
| 本切片 ESLint、Prettier、diff check | 通过                      |

当前边界：`TextRedactor` 已完成安全输出基础契约，但尚未接入 M10 evidence/report 发布流水线；故障 incident/policy、控制台动作/故障 UI 和生产包 QA_ACK 真机验收仍待后续切片。

## 当前边界

本 Task 1 切片未接入 bridge arm/ACK、失败策略或控制台 UI。命令持久化与 dispatcher 传递已在下方 Task 2 切片完成；真实 bridge ACK 和故障策略仍按 M9 计划逐步扩展。

## 真机验收

验收脚本：`tests/hardware/m9-longpress-drag.ts`

环境：设备 `192.168.22.73:5555`，游戏包 `com.hg.idleweaponshoptycoon.android`，Appium `3.6.0`，UiAutomator2 `8.2.2`。

结果：

```json
{
  "status": "PASS",
  "serial": "192.168.22.73:5555",
  "packageName": "com.hg.idleweaponshoptycoon.android",
  "sessionId": "fecb74aa-fef4-4558-b131-f1353193e834",
  "foregroundPackage": "com.hg.idleweaponshoptycoon.android",
  "longPressActions": 4,
  "dragActions": 5,
  "appiumPort": 4723,
  "systemPort": 8200,
  "mjpegPort": 7810
}
```

Appium 日志确认两次 W3C `/actions` 请求均返回 HTTP 200；删除 session 后 UiAutomator2 instrumentation 以 code 0 退出，并移除 `8200` 与 `7810` 的 ADB forward。验收结束后没有 `4723/8200/7810` 监听残留。

Back 真机验收脚本：`tests/hardware/m9-back.ts`。设备上通过 Appium `press_keycode` 发送 Android keycode `4`，请求返回 HTTP 200，前后台包均为 `com.hg.idleweaponshoptycoon.android`；session 删除、UiAutomator2 退出和 `8201/7811` ADB forward 清理均成功。

Activate 真机验收脚本：`tests/hardware/m9-activate.ts`。设备上通过 Appium `activate_app` 启动 `com.hg.idleweaponshoptycoon.android`，请求返回 HTTP 200；使用前台轮询等待异步启动完成后，包名校验通过，未发送 pointer actions，session 删除、UiAutomator2 退出和 `8202/7812` ADB forward 清理均成功。

Terminate 真机验收脚本：`tests/hardware/m9-terminate.ts`。设备上先启动游戏并通过 ADB `pidof` 得到 PID `2669`，再调用 Appium `terminate_app`；请求返回 HTTP 200，随后 `pidof` 确认进程消失，session 删除、UiAutomator2 退出和 `8203/7813` ADB forward 清理均成功。

Restart 真机验收脚本：`tests/hardware/m9-restart.ts`。脚本先调用 `terminate_app` 并等待进程消失，再调用 `activate_app`，轮询前台包名并确认 PID 已变化。两台已连接安卓真机均通过：

```json
[
  {
    "status": "PASS",
    "serial": "R5CWB17PN0Y",
    "packageName": "com.hg.idleweaponshoptycoon.android",
    "sessionId": "2dd37ad9-0bea-40f6-bb88-78c37601f1a5",
    "pidBefore": "3733",
    "pidAfter": "4612",
    "foregroundAfter": "com.hg.idleweaponshoptycoon.android",
    "appiumPort": 4727,
    "systemPort": 8204,
    "mjpegPort": 7814
  },
  {
    "status": "PASS",
    "serial": "R5CX211TXNT",
    "packageName": "com.hg.idleweaponshoptycoon.android",
    "sessionId": "052f2d10-c9cc-4df2-85c8-c0c6c549bb7f",
    "pidBefore": "22619",
    "pidAfter": "22915",
    "foregroundAfter": "com.hg.idleweaponshoptycoon.android",
    "appiumPort": 4727,
    "systemPort": 8204,
    "mjpegPort": 7814
  }
]
```

首次重启验收发现 Appium 冷启动 UiAutomator2 驱动时默认 15 秒就绪窗口不足，脚本已将服务就绪等待上限调整为 60 秒；随后发现安卓重启过渡期间 `current_package` 合法地返回 `null`，客户端现将其视为未稳定前台并继续轮询。两次验收均在删除 session 后完成 UiAutomator2 退出与端口清理。

## 审批边界

## M9 Task 8：typed incident 与失败策略决策矩阵

- 新增版本化 `Incident` 合约，覆盖 ADB、Appium、崩溃/前台、Bridge、文本焦点、metrics 和低磁盘类别。
- 新增不可变 `decideFailurePolicy`：默认 `PAUSE_ALL`；显式 quarantine 仅允许 active follower，leader、唯一活动成员、未知成员和 LOW_DISK 强制暂停。
- 每个决策固定 2,000 ms 响应预算和 deadline；检测时间倒退会被拒绝，incident 详情在决策结果中冻结。

| 检查                                              | 结果                      |
| ------------------------------------------------- | ------------------------- |
| incident schema 与 pause/quarantine focused tests | 7 个测试通过              |
| 全量自动化测试                                    | 80 个文件、339 个测试通过 |
| TypeScript project build                          | 通过                      |
| 本切片 ESLint、Prettier、diff check               | 通过                      |

当前边界：本切片只有纯逻辑决策器，尚未写入 incidents/recovery 数据库、驱动真实 fault monitor、暂停 session action API 或提供控制台故障时间线。

## M9 Task 9：incident 与 recovery 持久化

- 新增 `0011_incidents_recovery` 校验和迁移：保存版本化 incident、可选设备串号、检测时钟、证据引用和结构化详情。
- 新增 `IncidentRepository`：incident 按 `incidentId` 幂等写入，内容冲突拒绝；按 run 以检测时钟排序读取，并在读回时重新通过 typed schema 校验。
- 新增 recovery attempt 记录：保存 `PAUSE_ALL` / `QUARANTINE_DEVICE` 执行动作、目标设备、deadline、完成状态和错误；服务重启可查询 `STARTED` 未完成尝试。
- server runtime 启动迁移已包含 `INCIDENTS_MIGRATION`，后续 fault monitor 可直接使用同一数据库契约。

| 检查                                       | 结果                      |
| ------------------------------------------ | ------------------------- |
| incident/recovery repository focused tests | 3 个测试通过              |
| 全量自动化测试                             | 81 个文件、342 个测试通过 |
| TypeScript project build                   | 通过                      |
| 本切片 ESLint、Prettier、diff check        | 通过                      |

当前边界：本切片只完成持久化和恢复查询，尚未接入真实 fault monitor、暂停 session action API、策略执行器或控制台故障时间线。

## M9 Task 10：受保护暂停执行 API

- 新增受保护的 `POST /api/sessions/:id/pause`，要求现有 session cookie、同源和 CSRF 校验；暂停原因限制为非空、最多 128 字符。
- `RuntimeSessionRouteService.pause` 只允许 `RUNNING` 会话进入 `PAUSED`，先停止 managed workers，再记录 `RUNNING -> PAUSED` transition；故障场景不要求设备仍在线。
- 暂停时仅取消该 run 中 `QUEUED/LEASED` 的动作和目标结果；已经进入 `DISPATCHING` 的动作保持原状态，不伪造完成或取消。

| 检查                                | 结果          |
| ----------------------------------- | ------------- |
| pause service / route focused tests | 14 个测试通过 |
| 全量自动化测试                      | 待最终验证    |
| TypeScript project build            | 通过          |
| 本切片 ESLint、Prettier、diff check | 待最终验证    |

当前边界：本切片完成人工/监控可调用的暂停入口，尚未把 incident detector 自动连接到 pause、实现 quarantine 执行、恢复 API 或控制台故障时间线。

## M9 Task 11：incident recovery 执行协调器

- 新增可注入的 `IncidentMonitor`，将 typed incident 记录、failure policy 决策、recovery attempt 持久化和执行器调用串成一条闭环。
- 首次 incident 按决策执行 `pauseAll` 或 `quarantineDevice`；相同 `incidentId` 会复用最近 recovery 记录，不重复触发设备动作。
- 执行器异常会保留 incident 证据，并把 recovery attempt 完成状态写为 `FAILED` 与错误消息；不会吞掉故障事实。
- pause/quarantine 执行器保持接口注入，后续可分别绑定 `RuntimeSessionRouteService.pause` 和 run-device membership 更新，不在本切片猜测具体监控源。

| 检查                                | 结果         |
| ----------------------------------- | ------------ |
| incident monitor focused tests      | 2 个测试通过 |
| 全量自动化测试                      | 待最终验证   |
| TypeScript project build            | 通过         |
| 本切片 ESLint、Prettier、diff check | 待最终验证   |

当前边界：本切片完成 incident 到 recovery 的编排层，尚未接入 ADB/logcat/Appium/Bridge 真实监控源、quarantine 数据库状态更新和控制台故障时间线。

## M9 Task 12：quarantine 成员状态执行

- 新增 `0012_run_membership_transitions` 迁移，记录设备成员从 `ACTIVE` 到 `QUARANTINED` 的审计历史。
- 新增 `RunMembershipRepository.quarantine`：只允许当前 run epoch 的 active follower 被隔离；leader、未知设备和不可转换状态会拒绝。
- 已隔离 follower 再次执行返回 `DEDUPLICATED`，不会重复写状态或重复生成成员 transition。
- 新增 `RunMembershipIncidentExecutor` 适配器，将 quarantine 持久化接入 `IncidentMonitor` 执行器契约；pauseAll 继续由 runtime pause 回调注入。
- server runtime 启动迁移已包含 `RUN_MEMBERSHIP_MIGRATION`。

| 检查                                           | 结果                      |
| ---------------------------------------------- | ------------------------- |
| quarantine repository / executor focused tests | 3 个测试通过              |
| 全量自动化测试                                 | 83 个文件、351 个测试通过 |
| TypeScript project build                       | 通过                      |
| 本切片 ESLint、Prettier、diff check            | 通过                      |

当前边界：真实 ADB/logcat/Appium/Bridge 监控源、自动 incident 采集、恢复 API 和控制台故障时间线仍未接入。

## M9 Task 13：ADB 连接故障事件接线

- 新增 `DeviceConnectionFaultMonitor`，订阅 `DeviceRegistry` 的 `device.connectionChanged` 事件。
- `OFFLINE` / `UNAUTHORIZED` 连接变化会按当前 RUNNING run 生成稳定 `ADB_DISCONNECTED` incident；ONLINE 事件忽略。
- incidentId 使用 run、设备 serial 和 connectionSeq 组成，重复事件不会重复调用 `IncidentMonitor`；支持同一设备同时属于多个 run。
- server runtime 已接入 fault monitor：设备事件 -> typed incident -> IncidentMonitor -> pause/quarantine 执行器；启动和关闭生命周期均已接线。
- 当前默认策略沿用方案 A 的 `PAUSE_ALL`，后续可从 run 配置读取可选 quarantine 策略。

| 检查                                          | 结果                      |
| --------------------------------------------- | ------------------------- |
| device connection fault monitor focused tests | 2 个测试通过              |
| 全量自动化测试                                | 84 个文件、353 个测试通过 |
| TypeScript project build                      | 通过                      |
| 本切片 ESLint、Prettier、diff check           | 通过                      |

当前边界：已接入 ADB 连接状态故障源；logcat 崩溃/ANR、Appium/Bridge 状态故障、运行时配置化策略和控制台故障时间线仍待后续切片。

## M9 Task 14：Logcat 崩溃/ANR 故障事件接线

- 新增 `LogcatFaultMonitor`，识别明确的 `AndroidRuntime + FATAL EXCEPTION` 与 `ActivityManager + ANR in` 记录，统一生成 `APP_CRASH_OR_ANR` incident。
- 普通 Unity 错误日志不自动升级为 incident；仅当前 run 中仍为 active 的设备成员参与处理。
- 同一 run、设备、monotonic 时间和原始日志记录只处理一次；monitor 可停止并解除订阅。
- `LogcatStream` 新增可选 record sink，managed worker/coordinator 将解析记录转给 fault monitor；server/dev 启停生命周期已接线。
- 现有日志 segment/evidence 写入路径不变，fault monitor 只消费结构化记录，不读取或复制明文日志文件。

| 检查                                         | 结果                      |
| -------------------------------------------- | ------------------------- |
| logcat crash/ANR fault monitor focused tests | 2 个测试通过              |
| 全量自动化测试                               | 85 个文件、355 个测试通过 |
| TypeScript project build                     | 通过                      |
| 本切片 ESLint、Prettier、diff check          | 通过                      |

当前边界：已接入 Logcat 崩溃/ANR 识别和 runtime record sink；Appium/Bridge 故障源、真实游戏包崩溃现场验收、运行时策略配置和控制台故障时间线仍待后续切片。

当前改动仍未提交、未推送，等待用户验收后再创建提交并推送 `origin/main`。

## M9 Task 15：Appium/Bridge worker typed fault 接线

- 新增 `RuntimeFaultMonitor`，只接收带 run、serial、generation 和 faultId 的运行时故障事件，统一映射为 `APPIUM_SESSION_LOST`、`BRIDGE_TIMEOUT` 或 `BRIDGE_STATE_MISMATCH` incident。
- `DeviceWorker` 新增可选 fault sink：仅明确的 Appium session/fence、Bridge handshake/transport/clock/arm 错误会生成事件；未知启动异常和正常 stop 不会伪装成 incident。
- `RuntimeWorkerCoordinator` 新增 fault 订阅转发，server/dev 生命周期接入 monitor；已有 `IncidentMonitor`、pause/quarantine 执行逻辑保持不变。
- incidentId、faultId 对 run/serial/错误文本做字符清洗并限制长度；同一 run、设备、faultId 只处理一次，非 active 成员忽略。

| 检查                                                       | 结果                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| runtime fault monitor / worker / coordinator focused tests | 3 个文件、17 个测试通过                                           |
| 全量自动化测试                                             | 受本机依赖目录被 pnpm 整理造成 React 多副本影响，待依赖恢复后复验 |
| TypeScript project build                                   | 通过                                                              |
| 本切片 ESLint、Prettier、diff check                        | 待最终验证                                                        |

当前边界：已完成 Appium/Bridge worker 到 typed incident 的基础适配；尚未实现真实运行中 Appium 请求失败的持续监听、策略配置化和控制台故障时间线。

## M9 Task 16：动作期间 Appium fault 回写

- `AppiumActionExecutor` 新增可选 fault sink；动作期间仅把明确的 `SESSION_NOT_FOUND`、`TIMEOUT`、`NETWORK_ERROR`、`FENCE_MISMATCH` 映射为 typed runtime fault。
- `ActionDispatcher` 为 executor 补充 runId/actionId 上下文，故障 incident 可追溯到具体动作；原有 action target 失败回写和异常传播保持不变。
- server 通过 `RuntimeWorkerCoordinator.publishFault` 把动作 fault 送入既有 `RuntimeFaultMonitor`，不新增第二套 incident/recovery 逻辑。
- 未配置 run/action 上下文或未知异常不生成 fault；session cleanup 仍在 finally 中执行。

| 检查                         | 结果                    |
| ---------------------------- | ----------------------- |
| Appium action focused tests  | 1 个文件、10 个测试通过 |
| TypeScript project build     | 通过                    |
| ESLint、Prettier、diff check | 待最终验证              |

当前边界：已接入动作期间明确 Appium 请求故障的 typed incident 回写；尚未实现真实设备上的长时间网络抖动压测、策略配置化和控制台故障时间线。

## M9 Task 17：incident/recovery 时间线只读 API

- 新增受 bootstrap session 保护的 `GET /api/sessions/:id/incidents`，返回 run 对应的 incidents 与 recovery attempts。
- `IncidentRepository` 新增按 run 查询全部 recovery attempts 的只读方法；incident/recovery 数据保持原有排序和 typed schema 校验。
- server runtime 将只读 timeline service 接到实际 SQLite repository；无服务返回 503，不存在的 run 返回 404，未认证返回 401。
- API 只提供查询，不新增恢复、重试或动作副作用，为后续控制台故障时间线提供稳定数据契约。

| 检查                                      | 结果                   |
| ----------------------------------------- | ---------------------- |
| incident route / repository focused tests | 2 个文件、5 个测试通过 |
| TypeScript project build                  | 通过                   |
| ESLint、Prettier、diff check              | 通过                   |

当前边界：已提供 incident/recovery 查询接口；尚未实现控制台时间线 UI、分页/筛选和恢复操作入口。

## M9 Task 18：控制台故障时间线只读视图

- Sessions 页面新增只读故障时间线，按 incident 展示故障类别、设备串号、来源、代次、检测时间和详情。
- 每条 incident 关联展示最新 recovery 状态：处理中、已处理或处理失败；失败原因保留可换行显示。
- 时间线包含加载态、空态、错误态和刷新入口，刷新只重新读取 `/api/sessions/:id/incidents`，不触发任何恢复动作。
- 使用现有深色运维工作台、Lucide 图标和紧凑响应式布局；移动宽度下时间、状态和长错误文本不会挤出容器。

| 检查                         | 结果                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| TypeScript project build     | 通过                                                                    |
| ESLint、Prettier、diff check | 通过                                                                    |
| Sessions 页面自动化测试      | 受本机 React/ReactDOM 多副本 `Invalid hook call` 阻断，待依赖恢复后复验 |

当前边界：已完成控制台只读故障时间线；尚未实现分页/筛选、故障详情抽屉和恢复操作入口。
