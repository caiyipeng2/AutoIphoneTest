# M8 Task 3-2 Device Worker Managed 生命周期验收

## 本切片范围

本切片将 `DeviceWorker` 接入 M8 Task 3-1 的资源租约和 Appium 服务生命周期：

- managed 模式以 `runId + serial + generation` 申请 `WorkerResourceLease`。
- Appium 使用租约中的 Appium 端口和日志目录启动，再创建 W3C session，最后启动 logcat。
- managed 启动失败会按已完成层级回滚 session、logcat、Appium 和资源租约。
- managed 停止会继续执行全部清理步骤；即使 Appium 停止失败，也会释放资源租约并返回 `STOP_FAILED`。
- 停止后 generation 递增，下一次启动申请新的 generation。
- legacy `PortAllocator` 路径保持兼容；构造器拒绝 managed/legacy 配置不完整的组合。

## 测试证据

| 检查                                      | 结果                      |
| ----------------------------------------- | ------------------------- |
| DeviceWorker focused tests                | 1 个文件、9 个测试通过    |
| managed 启动顺序、端口/日志传递、失败回滚 | 通过                      |
| managed 停止失败继续清理、generation 递增 | 通过                      |
| legacy DeviceWorker 回归                  | 通过                      |
| TypeScript project build                  | 通过                      |
| 全量 Vitest                               | 74 个文件、289 个测试通过 |
| `git diff --check`                        | 通过                      |

## 当前边界

本切片使用 Appium service fake 验证生命周期，不启动真实 Appium 进程；尚未把 managed worker 接入服务器运行时、四设备并发编排、视频 profile、真机容量矩阵和 30 分钟 soak。这些属于后续 M8 切片。

## 审批边界

当前改动仍未提交、未推送，等待用户审批后再创建提交并推送 `origin/main`。
