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

| 检查                  | 命令                                                                                                                                                                                | 结果                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| M10 报告定向测试      | `npx vitest run tests/integration/report-finalization.test.ts tests/integration/report-persistent-crash-recovery.test.ts tests/security/report-output.test.ts packages/reports/src` | 16 个测试文件、48 个测试通过                                                        |
| 全量单元/集成测试     | `npm test`                                                                                                                                                                          | 146 个测试文件、589 个测试通过                                                      |
| TypeScript            | `npm run typecheck`                                                                                                                                                                 | 通过                                                                                |
| ESLint                | `npm run lint`                                                                                                                                                                      | 变更文件定向通过；仓库全量仍有既有 `scripts/write-release-manifest.mjs` 的 6 个错误 |
| 控制台生产构建        | `npm run build --workspace @test-center/console`                                                                                                                                    | 通过                                                                                |
| Playwright E2E        | `node .\\node_modules\\@playwright\\test\\cli.js test --workers=1`                                                                                                                  | 14 个用例通过，退出码 0                                                             |
| 离线 fixture 静态预检 | `powershell -ExecutionPolicy Bypass -File scripts/verify-report.ps1 -OutputRoot output/playwright/m10-acceptance-fixtures`                                                          | 通过，3 个 HTML 与 3 个 ZIP                                                         |

并行执行时曾出现一次与 M10 无关的 `DeviceDetails` 5 秒超时；该测试单独复现通过，随后独立全量重跑 146/589 全部通过，未确认存在稳定回归。

## 真实 Android 双机报告验收（2026-08-26）

本次使用项目当前构建产物和已安装的 `Idle Weapon Shop Tycoon` 包，在两台真实 Android 设备上验证报告主链路。运行时通过 Appium-only 模式启动，ADB 使用当前设备实际在线的 `5037` 服务端口。

| 项目         | 结果                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 设备         | `R5CX211TXNT`（LEADER）、`R5CWB17PN0Y`（FOLLOWER），2/2 在线                                          |
| 包标识       | `com.hg.idleweaponshoptycoon.android`，通过 ADB 安装态校验                                            |
| 会话         | `run-8da3fbb3-ba50-4c14-85c8-917d6b4894b7`，`PREFLIGHT -> RUNNING -> FINISHED`                        |
| 动作         | `tap`、`swipe`，2/2 设备目标均 `SUCCEEDED`                                                            |
| 默认报告     | HTML `READY`，7,551 bytes，SHA-256 `d2326b7d1c7054ad309ca04e4e4ab60baf1d2c99a8bb0cb3c4996d3666d5fcf4` |
| 默认证据包   | ZIP `READY`，2,713 bytes，SHA-256 `ffde66280dedf59e0018de9c0f5d4597e34cc528b67e814516e7492392b55579`  |
| ZIP manifest | 与 HTML 条目大小和 SHA-256 一致；解压后无路径越界                                                     |
| 收尾         | 服务端、Appium 临时端口已释放；两台设备仍保持 `device` 在线                                           |

原始本地证据位于 `data/hardware-m10-real-report-20260826/m11-portable-smoke.json`（`data/` 被 `.gitignore` 忽略）。HTML 报告为内联 CSS、CSP `default-src 'none'`、无脚本和远程资源，设备矩阵和动作结果可离线打开。

本次运行同时验证了 Excel/PDF/JUnit 可选导出，但这些输出属于 M11 能力，不计入 M10 默认报告门禁。

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
- Appium-only 模式不会注入 Unity QA Bridge，因此本次报告的 UID 列为 `Not recorded`；若要求报告必须展示游戏 UID，需要先接入 QA Bridge 或实现受控的应用侧 UID 读取，再单独进行 UID 门禁验收。
- 本次真机证据和文档修改目前只保留在本地，尚未提交或推送；待用户确认 M10 总验收后，才提交并推送 `main`，随后再开始 M11。
