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

本次结果：Vitest `28` 个测试文件、`135` 个测试通过；TypeScript、ESLint、控制台生产构建通过；Playwright Apps 页面在桌面和移动项目各 `1` 条通过。新增验收文件已通过定向 Prettier 检查；仓库中既有的三个全局格式告警未在本任务中改写。

## 真机观察

采集命令：

```powershell
$env:TEST_CENTER_DEVICE_SERIAL = "<明确的 adb serial>"
$env:TEST_CENTER_PACKAGE = "<明确的 Android package name>"
$env:TEST_CENTER_ADB_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe"
$env:TEST_CENTER_APKSIGNER_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\apksigner.bat"
$env:TEST_CENTER_JAVA_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\OpenJDK\\bin\\java.exe"
$env:TEST_CENTER_APKSIGNER_JAR_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\build-tools\\34.0.0\\lib\\apksigner.jar"
node tools/node/22.23.1/node_modules/tsx/dist/cli.mjs tests/hardware/m3-installed-identity.ts
```

脚本只读取 `pm path`、`dumpsys package`、启动 Activity 解析和包体流哈希，并用 Unity SDK 的 `java.exe -jar apksigner.jar` 读取 base APK 证书摘要；输出会写入 `data/milestones/m3-installed-identity-*.json`。本次若未提供两个必需环境变量，脚本以退出码 `2` 明确标记 `M3_HARDWARE_SKIPPED`，不得以猜测的包名替代。

本次实际运行结果：成功，退出码 `0`。

| 字段           | 结果                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| Serial / UID   | `R5CX211TXNT`                                                                |
| 包名           | `com.hg.idleweaponshoptycoon.android`                                        |
| 版本           | `2.0.5` / `59`                                                               |
| SDK            | min `24` / target `35`                                                       |
| Unity Activity | `com.hg.idleweaponshoptycoon.android/com.unity3d.player.UnityPlayerActivity` |
| 签名 SHA-256   | `e58cfe3544fd61237a10f6aedcd8f0e117d476f43995fd69717a960a6da58bec`           |
| 安装集 SHA-256 | `04876e3cb65da2bd05744931550b46d0f668650f22b58277e0ef7c1f3546892d`           |
| 证据文件       | `data/milestones/m3-installed-identity-1785903254566.json`                   |

`dumpsys package` 在该 Android 16 设备上只提供短签名令牌，不能直接当作证书摘要；实现已回退到 base APK 流式落盘后调用 `apksigner`，并在本地单元测试和上述真机运行中验证。

## 回滚证明

- 导入失败：Provider 调用 `discard` 删除 staging partial；数据库事务失败时删除新发布内容并记录 `FAILED`。
- 重复来源：保留既有 SHA-256 内容和制品 ID，只追加 `DEDUPLICATED` 导入尝试。
- 已安装登记：唯一键由设备 UID、包名、版本号、签名摘要和安装集摘要组成，重复登记返回既有记录。
- 服务回滚：删除 `data/artifacts` 下对应摘要目录即可移除来源内容，SQLite 中的来源记录应在同一维护窗口清理；已安装观察记录不删除来源文件。

## 已知限制

当前运行时 `RuntimeArtifactRouteService.parse` 仍返回空元数据；APK/AAB 解析器、签名校验和工具供应脚本已存在，但尚未接入真实导入服务。因此当前验收证明了内容哈希、持久化、去重、安全边界和已安装身份采集，不能宣称导入来源包体会自动填充包名/版本/签名。后续接入解析器时应复用现有 `ArtifactImportService.parse` 接口并补充真实 APK/AAB fixture。

## 验收结论

自动化、浏览器流程和显式设备身份采集均已在本地完成，证据 JSON 可复核。当前工作区仍等待用户审批，审批前不提交、不合并、不推送。
