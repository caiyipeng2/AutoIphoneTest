# M8 Task 3-3 Runtime Worker Coordinator 验收

## 本切片范围

- `RuntimeWorkerCoordinator` 按 `runId` 管理 1-4 个 managed `DeviceWorker`。
- session 从 `PREFLIGHT` 进入 `RUNNING` 前，先并发启动全部设备 worker。
- 任一 worker 启动失败时，停止该 run 已创建的全部 worker，数据库状态保持 `PREFLIGHT`。
- 运行时生产组装已创建资源租约、Appium、W3C client、ADB logcat 和 DeviceWorker 工厂。
- runtime close 会先停止所有 active worker，再关闭数据库。

## 测试证据

| 检查                          | 结果                       |
| ----------------------------- | -------------------------- |
| coordinator focused tests     | 2 个测试通过               |
| session runtime focused tests | 6 个测试通过               |
| DeviceWorker focused tests    | 9 个测试通过               |
| M8 Task 3-3 focused 合计      | 3 个文件、17 个测试通过    |
| TypeScript project build      | 通过                       |
| 全量 Vitest                   | 75 个文件、293 个测试通过  |
| `git diff --check`            | 通过                       |
| Android 真机 managed session  | 通过：`192.168.22.73:5555` |

## 当前边界

生产组装已接入服务器代码。真实验收使用以下环境：Appium `3.6.0`、UiAutomator2 `8.2.2`、游戏包 `com.hg.idleweaponshoptycoon.android`（versionCode `60`，versionName `2.0.6`）。

真机验收脚本 `tests/hardware/m8-runtime-session.ts` 完成了以下链路：ADB 在线探测、PREFLIGHT session 创建、managed worker 启动、Appium/W3C session 创建、状态进入 `RUNNING`、协调器停止和资源释放。结果如下：

```json
{
  "status": "PASS",
  "sessionId": "run-a8b78ed7-b621-4aa7-8e18-6d8799e7ed2c",
  "serial": "192.168.22.73:5555",
  "packageName": "com.hg.idleweaponshoptycoon.android",
  "state": "RUNNING",
  "activeSerials": ["192.168.22.73:5555"],
  "stoppedSerials": []
}
```

首轮真机运行发现 Windows 不能在 `shell:false` 下直接 spawn `appium.cmd`（`spawn EINVAL`），已改为由当前 Node 进程直接执行 Appium JS 入口，并在修复后完成上述通过结果。当前验收只覆盖一台 ADB 在线真机；双机同步仍需两台设备同时在线后执行专项验收。

## 审批边界

当前改动仍未提交、未推送，等待用户审批后再创建提交并推送 `origin/main`。
