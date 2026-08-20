# M10 Task 6 - 持久化数据库崩溃恢复验收记录

## 本切片范围

- 使用真实持久化 SQLite 数据库和独立 Node 子进程，分别覆盖 HTML、ZIP 在最终文件已 `rename`、数据库 `READY` 尚未写入时硬退出的边界。
- 重启后执行 `ReportFinalizationRecoveryService.reconcileStale`，验证 `FINALIZING` 收敛为 `INTERRUPTED`，仍为 `PENDING` 的导出收敛为 `FAILED/STARTUP_INTERRUPTED`，已写入 READY 的 HTML 保持 READY。
- 使用 `ReportFinalizationExecutor.retryFinalization` 进行报告-only retry，验证 attempt 2 的 HTML/ZIP 均变为 READY；该路径只读取 SQLite 报告快照，不调用设备 worker。

## 验证结果

- `tests/integration/report-persistent-crash-recovery.test.ts`：1 个测试通过，覆盖 HTML/ZIP 两种子进程崩溃路径。
- 子进程均以状态码 `75` 退出；最终文件存在但首次导出状态未被错误提升为 READY。
- 重启恢复、attempt 2 retry、旧 attempt 状态保留均通过断言。

## 后续边界

- 本切片不包含报告安全攻击矩阵、离线 Playwright 视觉检查、完整 M10 总验收或 Excel/PDF/JUnit/便携发布格式。
- 当前改动仅保留在本地，待用户确认后再提交并推送远端 `main`。
