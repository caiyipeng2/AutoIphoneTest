# M9 Task 1 动作命令策略验收

## 本切片范围

- 新增闭合 `ActionCommand` 联合：tap、long press、swipe、drag、Back、文本、activate、terminate、restart。
- 统一动作边界：长按 `300-10000ms`，路径 `2-128` 个点、时长 `50-30000ms`，文本 `1-2000` 个 Unicode scalar values。
- 固定 ACK 完成策略：输入类动作需要 bridge arm/ACK；activate/restart 等待 fresh bridge state；terminate 等待进程消失。
- 文本动作只产生长度和类别序列哈希描述，不在动作描述中保存明文，也不对短文本原文做可字典反推的内容哈希。

## 测试证据

| 检查                     | 结果          |
| ------------------------ | ------------- |
| 动作命令 focused tests   | 11 个测试通过 |
| TypeScript project build | 通过          |
| 本切片 ESLint            | 通过          |
| 本切片 Prettier          | 通过          |
| `git diff --check`       | 通过          |

## 当前边界

本切片只提供动作命令的纯解析、边界和策略描述，尚未把新动作接入 SQLite 持久化、DeviceWorker/Appium 执行、bridge arm/ACK、失败策略或控制台 UI。现有 session API 仍只接受 tap/swipe；后续切片将按 M9 计划逐步扩展。

## 审批边界

当前改动仍未提交、未推送，等待用户验收后再创建提交并推送 `origin/main`。
