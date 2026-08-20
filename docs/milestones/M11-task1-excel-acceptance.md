# M11 Task 1 - 公式安全 Excel 导出验收记录

## 本切片范围

- 锁定 `exceljs@4.4.0`，从 M10 不可变 `ImmutableReportModel` 生成可重开的 `.xlsx` 内容。
- 固定生成 `Summary`、`Devices`、`Actions`、`Incidents`、`Evidence` 五张工作表。
- 对 UID、设备序列号、动作标签、路径、详情、哈希和状态等非信任文本执行公式/控制字符安全策略。
- 保留可信模型字段的类型：epoch、数量、generation、sizeBytes 使用数字，时间字段使用 `Date`，哈希保持字符串。
- 发布通过同目录 `.partial` 文件写入、关闭后 rename；返回最终路径、字节数、SHA-256 和清洗计数。

## 实现文件

- `packages/reports/src/spreadsheet-value.ts`：`safeSpreadsheetText`，处理 `=`, `+`, `-`, `@`、制表/换行开头和非打印控制字符。
- `packages/reports/src/excel-exporter.ts`：五张表的确定性布局、冻结首行、自动筛选、边界列宽和原子发布。
- `packages/reports/src/excel-exporter.test.ts`：XLSX 重开、类型、公式单元、布局和发布哈希测试。
- `packages/reports/src/spreadsheet-value.test.ts`：公式、控制字符和 Unicode 策略测试。
- `tests/fixtures/reports/formula-values.json`：公式/控制字符/Unicode 输入样本。

## 验证结果

| 检查           | 命令                                                                                                                      | 结果                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| TDD RED        | `npx vitest run packages/reports/src/spreadsheet-value.test.ts packages/reports/src/excel-exporter.test.ts`（添加实现前） | 按预期因缺少 `exceljs` 和导出模块失败 |
| Excel 定向测试 | 同上（实现后）                                                                                                            | 2 个文件、11 个测试通过               |
| reports 包回归 | `npx vitest run packages/reports/src`                                                                                     | 16 个文件、56 个测试通过              |
| 全量测试       | `npm test`                                                                                                                | 137 个文件、533 个测试通过            |
| TypeScript     | `npm run typecheck`                                                                                                       | 通过                                  |
| ESLint         | `npm run lint`                                                                                                            | 通过                                  |
| 控制台生产构建 | `npm run build --workspace @test-center/console`                                                                          | 通过                                  |
| 格式和差异     | `npx prettier --check ...`、`git diff --check`                                                                            | 通过                                  |
| CodeGraph      | `codegraph sync`、`codegraph status`                                                                                      | 385 个文件、索引最新                  |

## 核心断言

- `=SUM(A1)`、`+1`、`-1`、`@user`、制表/换行开头值均写成带前缀的普通字符串，不生成 Excel formula cell。
- 非打印控制字符被替换为空格并计入 `sanitizedValueCount`；普通中文、日文和 Unicode 文本保持可读。
- 重新打开生成的工作簿后，五张工作表、冻结首行、自动筛选、可信数值/日期类型和相对证据路径均保持有效。
- 发布失败会清理 `.partial`，成功发布后 `.partial` 不存在，最终文件 SHA-256 与字节数由返回结果绑定。

## 交付边界

- 本切片不新增 API、导出队列、并发控制、Results 页面菜单、PDF/JUnit 或便携目录。
- Excel 是可选输出，默认 M10 HTML/ZIP 终态不受影响；M11 Task 3 才接入用户选择和异步导出作业。
- `npm install` 报告当前 Node 26 超出项目声明的 Node 22 引擎，并提示依赖树存在 2 个 moderate audit 项；这些不是本切片测试失败，待便携打包阶段统一处理。

## 审批门槛

当前改动仅保留在本地工作区，尚未提交或推送。待用户确认本切片验收通过后，才提交并推送 `main`，再进入 M11 Task 2。
