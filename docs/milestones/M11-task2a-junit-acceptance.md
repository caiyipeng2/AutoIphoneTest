# M11 Task 2A - JUnit XML 导出验收记录

## 本切片范围

- 从 M10 不可变 `ImmutableReportModel` 生成一个 JUnit XML suite。
- 每个 action target 生成一个 testcase；无 target 的 action 生成明确跳过用例。
- `FAILED` 映射为 `<failure type="TARGET_FAILED">`，`UNKNOWN` 映射为 `<error type="UNKNOWN">`，取消或未派发映射为 `<skipped message="CANCELLED">`。
- testcase properties 记录 action、serial、UID、generation；suite properties 记录 artifact/package 和 run ID。
- 只输出 evidence 的相对路径与 SHA-256 元数据，不输出动作标签、incident detail 或日志正文，避免 masked secret 回流。
- 使用 XML 文本/属性专用转义、非法 XML 控制字符归一化和同目录 `.partial` 原子发布。

## 实现文件

- `packages/reports/src/junit-exporter.ts`
- `packages/reports/src/junit-exporter.test.ts`
- `packages/reports/src/index.ts`

## TDD 与验证结果

| 检查           | 命令                                                                   | 结果                                  |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| RED            | `npx vitest run packages/reports/src/junit-exporter.test.ts`（实现前） | 按预期因缺少 `junit-exporter.js` 失败 |
| JUnit 定向测试 | 同上（实现后）                                                         | 1 个文件、2 个测试通过                |
| reports 包回归 | `npx vitest run packages/reports/src`                                  | 17 个文件、58 个测试通过              |
| 全量测试       | `npm test`                                                             | 138 个文件、535 个测试通过            |
| TypeScript     | `npm run typecheck`                                                    | 通过                                  |
| ESLint         | `npm run lint`                                                         | 通过                                  |
| 控制台生产构建 | `npm run build --workspace @test-center/console`                       | 通过                                  |
| 格式和差异     | `npx prettier --check ...`、`git diff --check`                         | 通过                                  |

## 核心断言

- suite `tests/failures/errors/skipped` 统计与 testcase 映射一致，运行时长由报告创建/更新时间确定性计算。
- `&`、`<`、引号和非法控制字符均安全处理；UID、run ID、artifact 等属性不会破坏 XML 结构。
- hostile 动作标签中的 `SECRET_TOKEN` 和 `<open shop>` 不出现在输出；system-out 只包含已发布证据路径和 SHA-256。
- 同一 immutable model 重复渲染结果完全一致；发布后最终文件可读取，`.partial` 不残留，返回 SHA-256/字节数与内容一致。

## 交付边界

- 本切片不包含 PDF/Chromium 离线渲染、Excel/PDF/JUnit 统一导出队列、Results 页面菜单或 E2E 导出流程。
- JUnit 当前以报告-only exporter 形式提供，待 Task 2B PDF 完成和 Task 3 批量作业接入后才暴露给用户选择。

## 审批门槛

当前改动仅保留在本地工作区，尚未提交或推送。待用户确认本切片验收通过后，才提交并推送 `main`，再继续 M11 Task 2B PDF 导出。
