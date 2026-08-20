# M10 Task 6 - 发布边界崩溃恢复验收记录

## 本切片范围

- 用独立 Node 子进程模拟 HTML 和 ZIP 发布器在 `TEMP_CREATED`、`RENAMED` 代表性边界被硬终止，并用同一发布器的故障注入矩阵覆盖全部五个阶段。
- 验证硬终止不会留下可见的半成品最终路径；启动恢复只删除受控命名规则的 `.partial-*`/`.partial` 文件，并保留已经完成 rename 的最终文件。
- stale `FINALIZING` 恢复时，将同一运行的 pending HTML/ZIP export 标记为 `FAILED/STARTUP_INTERRUPTED`，使后续 retry 不留下永久 pending 状态。
- 服务启动已接入 orphan partial 清理，再执行既有 finalization lease 恢复。

## 验证结果

- 阶段崩溃集成测试：HTML/ZIP 代表性子进程退出码均为 `75`，全部五个阶段的故障注入恢复后无 partial 文件。
- `packages/reports/src/report-finalization-recovery-service.test.ts`：3 个测试通过。
- 定向测试：2 个测试文件、5 个测试通过。
- 全量测试：134 个测试文件、520 个测试通过。
- `npm run typecheck`、`npm run lint`、控制台生产构建和 Prettier 检查均通过。
- 本切片不包含“rename 后 DB ready 之前”的持久化数据库子进程 fixture、报告安全攻击矩阵、离线 Playwright 视觉检查或最终 M10 总验收。

## 审批门槛

当前改动仅保留在本地工作区，尚未提交或推送。待用户确认本切片验收通过后，才执行提交并推送到远端 `main`。
