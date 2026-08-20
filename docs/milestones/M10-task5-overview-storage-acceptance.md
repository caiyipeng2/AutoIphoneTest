# M10 Task 5 / Overview 存储压力切片

日期：2026-08-20

## 范围

本切片完成 M10 Task 5 Step 5 中 Overview 的只读存储压力展示，不包含清理执行、确认 nonce、回收站移动或审计对话框。

## 已完成

- 服务端注册认证接口 `GET /api/storage/overview`。
- 运行时使用 `dataRoot` 的 Windows `statfs` 适配器采样可用空间，并以 30 秒轮询保持快照新鲜；启动采样失败时接口按需重试。
- 快照包含采样时间、`NORMAL/WARNING/BLOCKED` 压力、可用空间、20 GiB 警戒线、5 GiB 阻断线、当前写入速率、到阻断线的预计秒数和活跃会话数。
- 活跃会话统计覆盖 `CREATED/PREFLIGHT/RUNNING/PAUSED`，不计入已结束历史记录。
- 控制台 Overview 展示压力状态、可用空间、阈值、写入速率、预计剩余时间和活跃会话影响，并提供加载、错误和手动刷新状态。
- 失败或不可读磁盘容量不会泄露运行时异常细节；快照沿用存储策略的阻断语义。

## 验证证据

- `npm test -- --run apps/server/src/storage-runtime.test.ts apps/server/src/routes/storage.test.ts`：4/4 通过。
- `npm test -- --run apps/console/src/features/storage/StorageOverviewPanel.test.tsx apps/console/src/App.test.tsx apps/server/src/routes/storage.test.ts apps/server/src/storage-runtime.test.ts`：8/8 通过。
- `npm run typecheck`：通过。
- 定向 ESLint：0 errors、0 warnings（CSS 被配置忽略）。
- `git diff --check`：通过。

## 已知边界

- 本切片是只读展示。清理候选预览已经在 Settings 中存在，但清理确认、执行、恢复和审计结果仍属于后续原子切片。
- 当前写入速率由 `StoragePressureMonitor.recordWrite` 提供；若近期没有写入事件，界面显示“暂无估算”，不会伪造剩余时间。
- 全仓格式检查仍会命中既有 Unity 生成文件和历史未格式化文件；本切片新增/修改的 TypeScript、TSX 定向格式检查已通过。

## 审批门禁

本地实现和验证完成后等待用户确认；未获得确认前不提交、不合并、不推送远端。
