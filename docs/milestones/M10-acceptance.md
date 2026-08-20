# M10 - 默认报告总验收记录

## 验收范围

M10 交付历史结果、离线 HTML、原子证据 ZIP、报告最终化恢复、存储压力与审计清理，并覆盖正常、失败、故障恢复和中断运行。Excel/PDF/JUnit 等可选格式和 Windows 便携发布属于 M11，不在本次范围内。

## 功能切片汇总

| 区域                                                 | 验收证据                         | 结果                                                               |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| Evidence 状态、原子发布、强制采集、logcat 脱敏       | `docs/milestones/M10-task1-*.md` | 通过。PENDING 到 READY/FAILED/MISSING 的终态受事务和路径边界保护。 |
| 不可变报告模型与离线 HTML                            | `docs/milestones/M10-task2-*.md` | 通过。报告为内联 CSS、无脚本、无远程资源，并对文本和属性分别转义。 |
| ZIP64、manifest、哈希和独立校验                      | `docs/milestones/M10-task3-*.md` | 通过。证据条目、大小和 SHA-256 由 manifest 绑定，路径碰撞被拒绝。  |
| Results 历史、详情、HTML/ZIP 导出和最终化重试        | `docs/milestones/M10-task4-*.md` | 通过。历史只读；重试只运行报告代码，不调用设备动作。               |
| 存储压力、保留预览、回收站移动、确认 nonce 与审计 UI | `docs/milestones/M10-task5-*.md` | 通过。删除前必须有明确选择、确认和可恢复审计结果。                 |
| 崩溃恢复、安全矩阵、三类 fixture、视觉验收           | `docs/milestones/M10-task6-*.md` | 通过。见下方新鲜证据和截图矩阵。                                   |

## 新鲜自动化验证

| 检查                  | 命令                                                                                                                                                                                | 结果                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| M10 报告定向测试      | `npx vitest run tests/integration/report-finalization.test.ts tests/integration/report-persistent-crash-recovery.test.ts tests/security/report-output.test.ts packages/reports/src` | 16 个测试文件、48 个测试通过   |
| 全量单元/集成测试     | `npm test`                                                                                                                                                                          | 135 个测试文件、522 个测试通过 |
| TypeScript            | `npm run typecheck`                                                                                                                                                                 | 通过                           |
| ESLint                | `npm run lint`                                                                                                                                                                      | 通过                           |
| 控制台生产构建        | `npm run build --workspace @test-center/console`                                                                                                                                    | 通过                           |
| Playwright E2E        | `node .\\node_modules\\@playwright\\test\\cli.js test --workers=1`                                                                                                                  | 14 个用例通过，退出码 0        |
| 离线 fixture 静态预检 | `powershell -ExecutionPolicy Bypass -File scripts/verify-report.ps1 -OutputRoot output/playwright/m10-acceptance-fixtures`                                                          | 通过，3 个 HTML 与 3 个 ZIP    |

并行执行时曾出现一次与 M10 无关的 `DeviceDetails` 5 秒超时；该测试单独复现通过，随后独立全量重跑 135/522 全部通过，未确认存在稳定回归。

## 崩溃与恢复证据

- 发布边界子进程在 `TEMP_CREATED`、写入中、关闭、哈希、rename 等阶段硬退出，测试进程退出码为 `75`；恢复后没有把 partial 文件当成最终输出。
- 持久化 SQLite 场景覆盖“最终文件已 rename、数据库 READY 尚未写入”；重启后 pending 导出收敛为 `FAILED/STARTUP_INTERRUPTED`，报告重试生成 attempt 2，且不调用设备 worker。
- 最终化 lease、startup reconciliation 和报告-only retry 的证据分别记录在 `M10-task4-report-finalization-lease-acceptance.md`、`M10-task4-startup-recovery-acceptance.md`、`M10-task6-crash-recovery-acceptance.md` 和 `M10-task6-persistent-crash-acceptance.md` 文档中。

## 安全与完整性证据

- hostile HTML/SVG/IMG、事件属性、外部 URL、Unicode 路径和 token/CSRF/keystore secret 输入均通过转义、相对路径限制、CSP 和脱敏检查。
- ZIP manifest 拒绝绝对路径、目录穿越、重复 association ID、保留的 `report-html` ID 和大小/哈希不一致。
- 强制 ZIP64 和 64 位安全大小元数据通过确定性大文件模拟验证；未分配超大内存或写入超大测试文件。

## Fixture 哈希

生成目录：`output/playwright/m10-acceptance-fixtures`。

| 场景/文件                  | 字节数 | SHA-256                                                            |
| -------------------------- | -----: | ------------------------------------------------------------------ |
| `normal/report.html`       |   7201 | `4255A0329C2F5DE03B15273072AE2F003A203BDDB2980040B5150C00C15931AC` |
| `normal/evidence.zip`      |   2984 | `E14316460B5FF347B1F0DD6F9A3D37C3BFF99E29C9FF71591C83DEC81A417E2B` |
| `normal/fixture.json`      |     56 | `E974251C6BF6A7B9FBCAA097DF608AF5ED6F64CDE90A6DD086A6C7A5C1904F7B` |
| `failure/report.html`      |   8604 | `00129E67FB813F58BC2B1EA6BE0C43353642622A9501B67347B873298037A0FB` |
| `failure/evidence.zip`     |   3330 | `3DEF4B50DAD38D27BDC1DF05C609D8F3A548510C3CA6F11E26D3EE9472B6A176` |
| `failure/fixture.json`     |     58 | `32ECC8910E98A15AC1A44E973B8A93B31DD66BC90CB2D5807A0E9716B8F7C348` |
| `interrupted/report.html`  |   7549 | `F624FB349FAB7E28B588F968949A476E186D268D2D299B9030C26814F25E436B` |
| `interrupted/evidence.zip` |   2885 | `21337305E903C11EB7E2D235419B81ADC698379EC79C7DAF2D22061FD9342866` |
| `interrupted/fixture.json` |     66 | `0DD0031FE3723426DEA6F139AE8E3C723AF2DF6F2C72AD1820A4BA696CCF9FAD` |

## 视觉证据

| 场景                  | 视口          | 结果                                                                     | 截图                                                                  |
| --------------------- | ------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `normal`              | 1440x1000     | `FINISHED`、设备矩阵、动作和 evidence readiness 可读                     | `output/playwright/.playwright-cli/page-2026-08-20T09-30-18-973Z.png` |
| `failure`             | 1440x1000     | `FAILED`、双设备、incident、quarantine recovery 和缺失 evidence 可读     | `output/playwright/.playwright-cli/page-2026-08-20T09-32-20-409Z.png` |
| `interrupted`         | 1440x1000     | `INTERRUPTED`、recovering/left、cancelled action 和缺失截图可读          | `output/playwright/.playwright-cli/page-2026-08-20T09-34-29-886Z.png` |
| `interrupted`         | 375x812       | 页面宽度 360px，无页面级横向溢出；密集表格使用内部横向滚动               | `output/playwright/.playwright-cli/page-2026-08-20T09-35-48-051Z.png` |
| `normal` 内存离线重建 | 默认 CLI 视口 | `setOffline(true)` 后使用 `setContent` 仍可完整渲染，控制台错误/警告为 0 | `output/playwright/.playwright-cli/m10-normal-offline-memory.png`     |

报告初始加载只使用本机临时静态服务器；切换 offline 后没有外部请求，HTML 不依赖网络、脚本或远程资源。

## 已知限制与发布门禁

- 375px 窄屏密集表格保留内部横向滚动；当前 M10 目标以桌面报告为主。
- 视觉验收为人工截图和结构断言，没有建立像素差异基线或 CI 浏览器回归任务。
- 本记录没有宣称真实 Android 设备已完成 M10 报告产出；本次门禁使用确定性 fixture、持久化 crash 子进程和本地 E2E。
- 当前文档改动尚未提交或推送。待用户确认 M10 总验收后，才提交并推送 `main`，随后再开始 M11。
