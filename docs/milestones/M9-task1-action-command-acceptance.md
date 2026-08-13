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

## 当前边界

本切片尚未把新动作接入 SQLite 持久化、DeviceWorker/Appium dispatch、bridge arm/ACK、失败策略或控制台 UI。现有 session API 仍只接受 tap/swipe；本次执行层增量只提供 long press/drag 的 W3C pointer 映射函数，后续切片将按 M9 计划逐步扩展。

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

当前改动仍未提交、未推送，等待用户验收后再创建提交并推送 `origin/main`。
