# M6 单设备动作持久化 Schema 切片验收

日期：2026-08-11

## 本切片范围

- 新增 `0008_runs_actions` 数据库迁移，建立单设备运行、成员快照、动作、动作目标、outbox、设备结果和状态转移表。
- 约束同一运行内 `client_request_id` 与 `action_seq` 唯一，确保后续 repository 可以实现幂等和顺序分配。
- 约束同一运行同一 epoch 只能有一个活动 Leader；Follower 和历史 epoch 保留独立记录。
- 将迁移加入服务运行时初始化序列。现有 `0006_deployment_controls` 和 `0007_uid_bridge_observations` 已占用编号，因此动作迁移使用 `0008`。

## 自动化证据

| 检查                     | 结果                          |
| ------------------------ | ----------------------------- |
| 新增迁移测试             | 4/4 通过                      |
| 数据库/服务定向回归      | 3 个测试文件、9 个测试通过    |
| 全量 Vitest              | 66 个测试文件、251 个测试通过 |
| `npm run typecheck`      | 通过                          |
| Console 生产构建         | 通过                          |
| 改动文件 targeted ESLint | 通过                          |
| 改动文件 Prettier        | 通过                          |
| CodeGraph sync           | 已同步 3 个变更文件           |

## 未覆盖边界

- 本切片没有实现 run repository、action outbox dispatcher、崩溃恢复逻辑或 session API。
- 本切片没有连接 Android 真机，也没有执行真实 tap/swipe；这些内容必须在 schema 之后继续按原子切片完成。
- 当前仍遵循用户审批门禁，代码和记录保持本地未提交状态。
