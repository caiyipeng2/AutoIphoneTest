# M5 Unity QA Bridge 验收记录

## 范围

M5 覆盖 Unity QA Bridge 的协议握手、状态上报、九次设备时钟校准、UID/安装代际投影、受控动作的 ARM/ACK/拒绝、断线重连，以及控制台设备详情展示。生产游戏 `Idle Weapon Shop Tycoon` 的包名为 `com.hg.idleweaponshoptycoon.android`；正式生产包是否内置 QA Bridge 仍由发布构建负向检查决定。

## 自动化证据

本地命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
powershell -ExecutionPolicy Bypass -File scripts/run-unity-bridge-tests.ps1
powershell -ExecutionPolicy Bypass -File scripts/build-unity-bridge-fixture.ps1 -BuildMode qa
powershell -ExecutionPolicy Bypass -File scripts/build-unity-bridge-fixture.ps1 -BuildMode release
npx vitest run tests/integration/release-bridge-negative.test.ts
npx playwright test tests/e2e/device-bridge.spec.ts
```

真机命令必须显式指定串号和包名：

```powershell
$env:TEST_CENTER_DEVICE_SERIAL = "R5CX211TXNT"
$env:TEST_CENTER_PACKAGE = "com.caiyipeng.testcenter.fixture"
npx tsx tests/hardware/m5-unity-bridge.ts
```

脚本会建立临时 ADB forward，连接本机 QA fixture，采集 `QA_HELLO`、至少九条 `QA_STATE`、九次 `QA_PING`/`QA_PONG` 校时、UID/安装代际/状态序列，并验证一次有效 ARM、一次受控 tap、一次过期 ARM 拒绝和一次断线重连。结束时移除 forward；不会安装、清数据、卸载或启动未明确指定的包。证据 JSON 输出到 `data/milestones/m5-unity-bridge-*.json`。

## 发布负向检查

`qa-bridge-fixture.apk` 必须包含 `TestCenter.QaBridge.dll` 与 QA marker；`release-no-bridge.apk` 必须同时不包含 QA assembly、`QaBridgeServer`、`QA_STATE`、`QA_ARMED`、`QA_ACK` 和设备端口 `17501`。检查失败时 M5 不得进入发布审批。

## 当前验收结论

协议级和 QA fixture 级能力已具备本地验收条件。真机脚本和 Playwright 证据需要在当前设备在线、Unity fixture 已安装并运行时执行；缺少这些外部条件时脚本只输出 `M5_HARDWARE_SKIPPED` 或失败证据，不得伪造通过。生产游戏接入仍保持 Provider/UPM 接口，未直接修改游戏仓库。

## 已知限制

- 当前只有一台已知真机时执行单设备证据；1-4 台调度和同步属于后续 M6/M7 验收。
- 生产包的真实 QA Bridge 注入必须由游戏仓库的 UPM/Provider 接入审批完成后再做，不以 fixture 结果替代生产包证据。
