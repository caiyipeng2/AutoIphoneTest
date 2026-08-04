# M0 环境自检验收记录

## 结论

M0 代码与自动化门禁已完成。本机两次真实自检均返回 `DEGRADED`（退出码 `2`），且探针的严重级别、解析路径、版本和错误类别一致。该状态准确表示当前机器尚未接入安卓设备，且 M1 以后需要的部分固定版本工具尚未安装，不表示 M0 自检功能失败。

生成的诊断数据位于被 Git 忽略的 `data/diagnostics/`，未提交到仓库。

## 使用方式

在仓库根目录运行：

```powershell
.\scripts\run-self-check.cmd
```

可选参数仅有：

```powershell
.\scripts\run-self-check.cmd --output 'E:\absolute\report-directory'
.\scripts\run-self-check.cmd --open
```

默认输出目录为 `<repo>\data\diagnostics\<UTC timestamp>`。诊断退出码为：`0` 表示健康、`2` 表示可修复降级、`3` 表示阻断性故障；一键脚本在 TypeScript 构建失败时返回独立退出码 `10`，不会与诊断降级混淆。

## 自动化证据

验证日期：2026-08-04。

| 门禁                     | 结果                                             |
| ------------------------ | ------------------------------------------------ |
| Vitest                   | `7` 个文件、`68` 项测试通过                      |
| 无 `dist` 完整 Vitest    | 临时移走并自动恢复三个构建目录后，完整测试仍通过 |
| TypeScript project build | 通过，退出码 `0`                                 |
| ESLint                   | 通过，退出码 `0`                                 |
| Prettier check           | 通过，退出码 `0`                                 |
| npm workspace            | 离线安装与 `npm ls --all` 均通过，`0` 个漏洞     |

执行命令：

```powershell
.\tools\node\22.23.1\node.exe .\node_modules\vitest\vitest.mjs run
.\tools\node\22.23.1\node.exe .\node_modules\typescript\bin\tsc --build --pretty false
.\tools\node\22.23.1\node.exe .\node_modules\eslint\bin\eslint.js .
.\tools\node\22.23.1\node.exe .\node_modules\prettier\bin\prettier.cjs --check .
.\tools\node\22.23.1\npm.cmd install --ignore-scripts --offline
.\tools\node\22.23.1\npm.cmd ls --all
```

原子发布测试覆盖：任一写入或重命名失败时执行回滚；若文件系统连回滚删除也拒绝，会抛出包含可能残留路径的 `AggregateError`，不会伪装成清理成功。成功时先写同目录 `.partial` 文件再原子重命名；HTML 对外部输出进行转义，且不包含脚本、任意命令按钮或 `onclick` 处理器。真实运行后 `.partial` 文件数量为 `0`。

## 真实机器证据

| 运行 | UTC 时间                   | 入口                         | 退出码 | JSON SHA-256                                                       |
| ---- | -------------------------- | ---------------------------- | -----: | ------------------------------------------------------------------ |
| 1    | `2026-08-04T05:47:00.876Z` | `scripts/run-self-check.cmd` |    `2` | `b063481a44aed07cfe18d0338ac5ca77e57aaba1da8c78b4f019425a92c95095` |
| 2    | `2026-08-04T05:47:46.053Z` | `scripts/run-self-check.cmd` |    `2` | `466e02bc10f2933233c5a3367f5c0d79d76b82afc379ee7076a680cef388e1f0` |

第二次运行的交付文件：

- JSON：`E:\Projects\UnityMultiDeviceTestCenter-worktrees\m0-environment-self-check\data\diagnostics\2026-08-04T05-47-46-053Z\environment-diagnostic-466e02bc10f2933233c5a3367f5c0d79d76b82afc379ee7076a680cef388e1f0-3468ab79-64af-4aa7-b96a-a6aaeae74233.json`
- HTML：`E:\Projects\UnityMultiDeviceTestCenter-worktrees\m0-environment-self-check\data\diagnostics\2026-08-04T05-47-46-053Z\environment-diagnostic-466e02bc10f2933233c5a3367f5c0d79d76b82afc379ee7076a680cef388e1f0-3468ab79-64af-4aa7-b96a-a6aaeae74233.html`

两次运行的语义签名一致；仅 `generatedAt`、探针耗时、E 盘实时剩余空间等动态字段不同。

## 当前探针结果

| 探针           | 状态       | 实际结果                                                                                                             |
| -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `drive`        | `HEALTHY`  | `E:\` 剩余空间高于 20 GiB；排他创建、写入、删除验证通过且无标记残留                                                  |
| `node`         | `HEALTHY`  | `E:\Projects\UnityMultiDeviceTestCenter-worktrees\m0-environment-self-check\tools\node\22.23.1\node.exe`，`v22.23.1` |
| `unity`        | `HEALTHY`  | `D:\Unity\Editor\Unity.exe`，`2022.3.62f2`；Android Player、SDK、ADB、JDK、NDK 均存在                                |
| `ports`        | `HEALTHY`  | `127.0.0.1:4723` 可用于 Appium                                                                                       |
| `adb`          | `DEGRADED` | Unity 内置 ADB `35.0.0` 可用，但当前在线设备数为 `0`                                                                 |
| `java`         | `DEGRADED` | Unity 内置 Java 为 `11.0.14.1`，项目固定版本要求为 `17.0.19`                                                         |
| `appium`       | `DEGRADED` | 固定版本 `3.6.0` 尚未安装                                                                                            |
| `uiautomator2` | `DEGRADED` | 固定版本 `8.2.2` 尚未安装                                                                                            |
| `bundletool`   | `DEGRADED` | 固定版本 `1.18.3` 尚未安装                                                                                           |
| `scrcpy`       | `DEGRADED` | 固定版本 `3.1` 尚未安装                                                                                              |

## 已知边界

- 当前没有安卓设备在线，因此本次只能验收 ADB 的发现与状态分类，不能验收真实设备元数据；设备发现属于 M2，设备同步属于 M7/M8。
- M0 只检测并报告缺失组件，不修改系统 PATH、注册表或全局工具配置，也不自动安装 Appium、Java、bundletool、scrcpy。
- 本地应用浏览器安全策略拒绝加载 `file://` 报告；HTML 的结构、内容、转义和原子发布已由自动测试验证，可由用户直接打开上述 HTML 文件验收视觉效果。

## 回滚

M0 尚未合并到 `main`。首选回滚方式是删除评审分支/工作树；若已合并，则先通过 `git log origin/main..codex/m0-environment-self-check` 确认 M0 提交，并按从新到旧的顺序执行 `git revert`。确认不再需要本机证据后，可单独删除仓库内被忽略的 `data\diagnostics` 与 `tools\node\22.23.1` 目录。不要使用 `git reset --hard`。
