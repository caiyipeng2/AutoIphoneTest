# M10 Task 4：Results 最终化重试安全契约验收记录

## 本切片范围

- 新增受认证的 `POST /api/results/:runId/retry-finalization` 路由。
- 写操作强制校验 loopback Host、控制台 Origin、登录会话和 CSRF token。
- 强制要求 `Idempotency-Key`，并限制为 1-128 个字符，交给后续执行器做请求去重。
- 仅允许 `FINALIZATION_FAILED` 或 `INTERRUPTED` 状态进入重试；已完成结果返回 `409`。
- 未接入最终化执行器时明确返回 `503`，避免伪造“重试成功”。
- 控制台新增 `retryResultFinalization` 客户端契约，自动携带 CSRF token 并透传服务端错误。

## 验证证据

| 检查项                  | 结果                                          |
| ----------------------- | --------------------------------------------- |
| Results 路由定向测试    | 通过，4/4                                     |
| 控制台 API 契约定向测试 | 通过，2/2                                     |
| 全量测试                | 通过，113 个测试文件、445 个测试              |
| TypeScript 全量类型检查 | 通过，`npm run typecheck`                     |
| ESLint 全量检查         | 通过，`npm run lint`                          |
| 控制台生产构建          | 通过，`npm run build -w @test-center/console` |
| 本切片文件格式检查      | 通过，新增/修改文件已使用 Prettier            |

## 交付边界

本切片只完成最终化重试的安全入口和前端调用契约，不包含从持久化快照重新生成 HTML/ZIP 的实际执行器，也不新增页面按钮。执行器接入后，服务实现 `retryFinalization` 即可复用本接口；当前未提交或推送，等待用户验收确认。
