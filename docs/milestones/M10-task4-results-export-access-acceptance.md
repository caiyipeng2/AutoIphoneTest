# M10 Task 4：Results HTML/ZIP 导出读取验收记录

## 本切片范围

- 新增受认证的 `GET /api/results/:runId/exports/:format` 只读读取路由。
- 仅允许 `READY` 且具有 `finalRelativePath` 的 HTML/ZIP 输出被读取。
- HTML 使用内联响应，ZIP 使用附件下载响应，并设置固定安全文件名。
- 文件路径必须位于运行根目录内，并通过真实路径复核，阻断 `..` 穿越或符号链接逃逸。
- Results 详情页按输出状态显示“打开 HTML”和“下载 ZIP”入口；未就绪输出不显示操作。

## 验证证据

| 检查项 | 结果 |
| --- | --- |
| Results 路由定向测试 | 通过，3/3 |
| Results 页面定向测试 | 通过，3/3 |
| 全量测试 | 通过，112 个测试文件、442 个测试 |
| TypeScript 全量类型检查 | 通过，`npm run typecheck` |
| ESLint 全量检查 | 通过，`npm run lint` |
| 控制台生产构建 | 通过，`npm run build -w @test-center/console` |
| 本切片文件格式检查 | 通过，Prettier |

## 交付边界

本切片只提供已完成报告文件的安全读取，不包含最终化重试、报告删除、分页或额外 JSON/JUnit/PDF 导出。当前改动尚未提交或推送，等待用户验收确认。
