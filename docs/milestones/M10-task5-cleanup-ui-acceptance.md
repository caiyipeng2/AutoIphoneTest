# M10 Task 5 - 清理确认与审计结果 UI 验收记录

## 本切片范围

- 在清理预览中逐条选择候选运行，支持全选与取消选择。
- 展示选中运行数量和预计释放空间。
- 打开破坏性操作确认对话框，列出准确的运行 ID、大小和风险提示。
- 必须勾选明确确认项后，才允许请求一次性确认 nonce 并执行清理。
- 展示 `DELETED` 完成结果或 `RECOVERY_REQUIRED` 恢复要求，并读取追加式审计事件时间线。

## 实现边界

- 复用现有 `/api/cleanup/confirmations`、`/api/cleanup/execute` 和 `/api/cleanup/:id/events` 接口。
- 服务端继续负责登录、同源、CSRF、候选状态、nonce、路径安全和回滚；本切片没有绕过或修改这些保护。
- 本切片没有加入受保护运行编辑、自动清理调度、恢复重试按钮，也没有对真实设备或真实生产证据执行破坏性验收。

## 验证结果

- 定向测试：3 个文件、8 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：132 个测试文件、515 个测试通过。
- `npm run build --workspace @test-center/console`：通过。
- `git diff --check`：通过。
- CodeGraph：已同步，373 个文件、5,195 个节点，索引为最新。
- UI 测试覆盖：未勾选时禁止执行、选中候选后打开确认框、成功/恢复要求结果、审计事件展示。
- 浏览器入口：本地 `http://127.0.0.1:4780/#settings` 已打开，清理预览空状态和禁用清理按钮显示正常；截图见 `output/playwright/m10-task5-cleanup-settings.png`。

## 审批门槛

当前改动仅保留在本地工作区，尚未提交或推送。待用户确认本切片验收通过后，才执行提交并推送到远端 `main`。
