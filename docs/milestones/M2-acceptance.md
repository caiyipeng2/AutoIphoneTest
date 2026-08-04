# M2 设备发现验收

## 结果

M2 已完成：ADB 设备发现、串行号绑定、受限元数据采集、SQLite 设备身份/连接历史、标签分组、认证 API、WebSocket 状态事件和 Devices 页面均已接入。

设备容量按实际发现数量展示，支持 1-4 台；UID 使用设备序列号作为稳定设备身份，游戏账号映射仍留在后续 Unity QA 桥接阶段。

## 自动化证据

在 `E:\Projects\UnityMultiDeviceTestCenter-worktrees\m2-device-discovery` 执行：

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
npm run build --workspace @test-center/console
```

结果：19 个测试文件、105 个测试通过；TypeScript、ESLint、Prettier 和控制台生产构建通过。

## 真实设备证据

执行：

```powershell
$env:TEST_CENTER_DEVICE_SERIAL = "R5CX211TXNT"
$env:TEST_CENTER_ADB_PATH = "D:\\Unity\\Editor\\Data\\PlaybackEngines\\AndroidPlayer\\SDK\\platform-tools\\adb.exe"
node node_modules/tsx/dist/cli.mjs tests/hardware/m2-device-discovery.ts
```

输出摘要：

| 字段          | 结果          |
| ------------- | ------------- |
| Serial / UID  | `R5CX211TXNT` |
| 状态          | `ONLINE`      |
| 型号          | `SM-S9280`    |
| Android / API | `16` / `36`   |
| 电量          | `99%`         |
| 方向          | `0`           |
| 注册连接序号  | `1`           |

测试路径为 `AdbClient -> parseDevicesOutput -> collectDeviceMetadata -> DeviceRegistry -> SQLite DeviceRepository`，未绕过 M2 实现。

## 操作流程

1. 启动本地服务并打开控制台，完成一次性 Bootstrap 交换。
2. 进入“设备”，页面从 `GET /api/devices` 读取权威设备列表。
3. ADB 轮询发现 1-4 台设备；在线设备读取型号、Android/API、电量、屏幕和方向等字段。
4. 设备暂时消失时，原序列号记录转为离线并保留已知元数据；重新出现时复用同一身份并递增连接序号。
5. 使用设备行的标签入口编辑标签和分组；该操作只写元数据和审计事件，不执行 ADB 命令。
6. WebSocket 推送 `device.upserted` 和 `device.connectionChanged`，页面自动刷新。

## 边界与后续

- 本次没有自动执行物理拔线/插线，避免在用户设备上进行未经确认的硬件操作；离线、重连、重复轮询和元数据保留由自动化状态机覆盖。
- M2 不包含 APK 安装、Unity 游戏启动、跨设备同步、测试会话和报告生成，这些保持在后续里程碑接口中。
- 默认 ADB 路径可通过 `TEST_CENTER_ADB_PATH` 覆盖，数据目录可通过 `TEST_CENTER_DATA_ROOT` 覆盖；运行时数据库位于 E 盘项目数据目录内。
