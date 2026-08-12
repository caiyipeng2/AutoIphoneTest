# M8 Task 3-1 Worker 资源租约基础验收

## 本切片范围

本切片为每个 Android Worker 建立可回收的资源租约，支持实际接入 1-4 台设备：

- Worker 身份键为 `runId + serial + generation`。
- 每个 Worker 原子申请 Appium、system、MJPEG 和 bridge 四类端口。
- 每个 Worker 拥有独立的 `logs`、`preview`、`evidence` 路径。
- 租约以 manifest 持久化，重复申请同一身份幂等，已占用 serial 的其他 generation 被拒绝。
- bridge 端口申请失败时回滚基础端口租约和已创建路径。
- 释放资源必须提供匹配的 owner token；释放后端口、目录和 manifest 记录一并清理。
- 管理器内部对 allocate/release 进行串行化，避免多 Worker 并发写 manifest 造成覆盖。

## 测试证据

| 检查 | 结果 |
| --- | --- |
| Worker 资源租约 focused tests | 1 个文件、5 个测试通过 |
| 1-4 Worker 串行资源隔离 | 通过 |
| 1-4 Worker 并发分配与 manifest 完整性 | 通过 |
| 失败回滚、重复申请、精确 owner 释放 | 通过 |
| TypeScript project build | 通过 |
| 全量 Vitest | 74 个文件、284 个测试通过 |
| `git diff --check` | 通过 |

## 当前边界

本切片只提供资源租约基础层，尚未接入真实 Appium worker 进程生命周期、真实端口探测、视频 profile、部署页 UI、1-4 台真机容量矩阵和 30 分钟 soak。这些属于后续 M8 Task 3-2 及后续切片。

## 审批边界

当前改动仍未提交、未推送，等待用户审批后再创建提交并推送 `origin/main`。
