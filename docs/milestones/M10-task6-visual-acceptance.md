# M10 Task 6 - 离线报告视觉验收记录

## 本切片范围

- 对 `FINISHED` 正常运行、双设备 `FAILED` 故障恢复运行、`INTERRUPTED` 中断运行三种报告 fixture 做浏览器视觉验收。
- 验证报告在加载后切换离线状态仍可渲染，且不产生外部网络依赖或控制台错误。
- 覆盖桌面视口 `1440x1000` 和窄视口 `375x812`，检查页面级横向溢出、内容完整性和表格可读性。
- 保留 Playwright 截图作为人工复核证据；本切片不引入像素差异基线。

## 静态离线预检

执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-report.ps1
```

结果：通过。三种 fixture 均生成 `report.html` 和 `evidence.zip`；HTML 均包含 `default-src 'none'`，不含脚本、外链、协议型 URL、`data:` 或 `javascript:` 内容；ZIP 数量与报告数量一致。

## Playwright 验收矩阵

| 场景                  | 视口          | 结果                                                                                                      | 证据                                                                  |
| --------------------- | ------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `normal`              | 1440x1000     | 通过。`FINISHED`、1 台设备、1 个成功动作、0 个 incident、0 个 evidence gap 均可见。                       | `output/playwright/.playwright-cli/page-2026-08-20T09-30-18-973Z.png` |
| `failure`             | 1440x1000     | 通过。`FAILED`、2 台设备、`APP_CRASH_OR_ANR`、`QUARANTINE_DEVICE`、`MISSING/DEVICE_DISCONNECTED` 均可见。 | `output/playwright/.playwright-cli/page-2026-08-20T09-32-20-409Z.png` |
| `interrupted`         | 1440x1000     | 通过。`INTERRUPTED`、leader recovering、follower left、cancelled action 和缺失截图均可见。                | `output/playwright/.playwright-cli/page-2026-08-20T09-34-29-886Z.png` |
| `interrupted`         | 375x812       | 通过。页面宽度 `360px`，无页面级横向溢出；密集表格使用内部横向滚动，内容不发生重叠。                      | `output/playwright/.playwright-cli/page-2026-08-20T09-35-48-051Z.png` |
| `normal` 内存离线重建 | 默认 CLI 视口 | 通过。先读取 HTML，再 `context.setOffline(true)` 并使用 `page.setContent` 重建，页面完整可读。            | `output/playwright/.playwright-cli/m10-normal-offline-memory.png`     |

## 网络与控制台结果

- 页面初始加载通过本机临时静态服务器完成，仅用于绕过 Playwright CLI 对 `file:` 协议的限制。
- 初始页面加载后切换离线状态；请求检查未发现外部请求，控制台检查结果为 `Errors: 0, Warnings: 0`。
- 内存离线重建后再次检查，报告内容、标题和布局尺寸仍有效。

## 已知限制

- 375px 窄屏下设备矩阵、动作时间线和证据表格保留内部横向滚动，以维持字段可读性；M10 当前交付目标以桌面报告为主。
- 当前为人工截图验收，没有建立像素差异基线或 CI 浏览器回归任务；后续可在 M11/发布流水线中固化。

## 审批门槛

当前改动仅保留在本地工作区，尚未提交或推送。待用户确认本切片验收通过后，才执行提交并推送到远端 `main`。
