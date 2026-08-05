# M3 应用制品库验收

## 范围

M3 Task6 验收覆盖：APK/AAB 来源制品按 SHA-256 去重、流中断清理、非法输入边界、已安装身份重复登记、Apps 页面浏览器流程，以及只读 Android 真机身份采集。安装、卸载、清数据、启动游戏和修改设备状态不属于本次采集动作。

## 自动化证据

在 `E:\Projects\UnityMultiDeviceTestCenter-worktrees\m3-artifact-library` 执行：

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
npm --workspace @test-center/console run build
npx playwright test tests/e2e/apps.spec.ts
```

集成测试必须证明：同一内容使用两个文件名导入后只有一个来源制品；第二次返回 `DEDUPLICATED`；半途异常不会遗留 `.partial`；非法非 ZIP 输入返回 `INVALID_FORMAT`；同一设备 UID、包名、版本、签名和安装集摘要重复登记只产生一条已安装记录；最终内容库不含孤儿临时文件。

本次结果：Vitest `28` 个测试文件、`132` 个测试通过；TypeScript、ESLint、控制台生产构建通过；Playwright Apps 页面在桌面和移动项目各 `1` 条通过。新增验收文件已通过定向 Prettier 检查；仓库中既有的三个全局格式告警未在本任务中改写。

## 真机观察

采集命令：

```powershell
$env:TEST_CENTER_DEVICE_SERIAL = "<明确的 adb serial>"
$env:TEST_CENTER_PACKAGE = "<明确的 Android package name>"
$env:TEST_CENTER_ADB_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe"
node tools/node/22.23.1/node_modules/tsx/dist/cli.mjs tests/hardware/m3-installed-identity.ts
```

脚本只读取 `pm path`、`dumpsys package`、启动 Activity 解析和包体流哈希，并与直接 ADB 命令的成功状态及输出长度做对照；输出会写入 `data/milestones/m3-installed-identity-*.json`。本次若未提供两个必需环境变量，脚本以退出码 `2` 明确标记 `M3_HARDWARE_SKIPPED`，不得以猜测的包名替代。

本次实际运行结果：`M3_HARDWARE_SKIPPED`，退出码 `2`。当前环境没有提供 `TEST_CENTER_DEVICE_SERIAL` 和 `TEST_CENTER_PACKAGE`，因此没有执行任何设备变更动作，也没有生成真机身份证据 JSON。

## 回滚证明

- 导入失败：Provider 调用 `discard` 删除 staging partial；数据库事务失败时删除新发布内容并记录 `FAILED`。
- 重复来源：保留既有 SHA-256 内容和制品 ID，只追加 `DEDUPLICATED` 导入尝试。
- 已安装登记：唯一键由设备 UID、包名、版本号、签名摘要和安装集摘要组成，重复登记返回既有记录。
- 服务回滚：删除 `data/artifacts` 下对应摘要目录即可移除来源内容，SQLite 中的来源记录应在同一维护窗口清理；已安装观察记录不删除来源文件。

## 已知限制

当前运行时 `RuntimeArtifactRouteService.parse` 仍返回空元数据；APK/AAB 解析器、签名校验和工具供应脚本已存在，但尚未接入真实导入服务。因此当前验收证明了内容哈希、持久化、去重和安全边界，不能宣称包名/版本/签名已由真实包体自动解析。后续接入解析器时应复用现有 `ArtifactImportService.parse` 接口并补充真实 APK/AAB fixture。

## 验收结论

自动化和浏览器流程完成后，只有在显式设备 serial 与包名采集成功、证据 JSON 可复核时，M3 Task6 才可标记为“完成”。缺少真机环境变量或设备不在线时，结论保持“自动化完成，真机观察待确认”。
