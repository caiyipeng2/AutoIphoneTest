# M8 Task 3-2 安卓真机包体验收

## 执行环境

- 包体：`idle_weaponshop_haiwai_v60_2026_08_07_21_06-release.apks`
- 包名：`com.hg.idleweaponshoptycoon.android`
- 版本：`versionCode=60`，`versionName=2.0.6`
- ADB：Unity Android SDK platform-tools，`1.0.41 / 35.0.0-11411520`
- bundletool：`1.15.4`

## 设备结果

| 设备 | Android ID | 安装 | 启动 | 进程 | 崩溃信号 |
| --- | --- | --- | --- | --- | --- |
| Samsung SM-A5460 (`R5CWB17PN0Y`) | `81c5b36a547fd7cb` | 通过，`lastUpdateTime=2026-08-12 15:21:51` | UnityPlayerActivity 前台 | PID `10940` | 未发现 FATAL/CRASH/SIGSEGV |
| Samsung SM-S9280 (`R5CX211TXNT`) | `c6c2d32cda443613` | 通过，`lastUpdateTime=2026-08-12 15:25:53` | UnityPlayerActivity 前台 | PID `6778` | 未发现 FATAL/CRASH/SIGSEGV；存在网络 DNS timeout |

## 说明

- ADB 同时显示的 `192.168.22.73:5555` 与 `R5CX211TXNT` 是同一台 S9280 的 USB/TCP 双连接，实际物理设备数量为 2 台。
- 覆盖安装未执行卸载、清数据或账号重置。
- 本次是真机包体安装、启动和基础进程验收；M8 Task 3-2 的 managed `DeviceWorker` 仍未接入服务器运行时，因此不能据此宣称真实 Appium worker 生命周期已在真机完成。
