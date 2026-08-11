# M6 Task 5 Console 主视图验收记录

日期：2026-08-10
范围：会话页主设备串号选择、WebSocket 视频消息接入、WebCodecs H.264/JPEG 解码视图、响应式展示。

## 本切片交付

- 会话页提供 Android 设备串号输入框，连接按钮只在串号非空时启用。
- `VideoViewport` 通过既有 `/ws/video/:serial` 通道接收 `video.frame` 消息。
- 浏览器具备 WebCodecs 时，H.264 帧进入 `VideoDecoder`，JPEG 帧走 `createImageBitmap` 兜底。
- 浏览器不支持 H.264 时展示可操作的降级状态和重试按钮。
- 主视图画布保持稳定尺寸，并为移动端保留可读的状态、错误和元数据区域。

## 自动化证据

| 检查                                             | 结果                                             |
| ------------------------------------------------ | ------------------------------------------------ |
| `npm run test -- --run`                          | 65 个测试文件、247 个测试通过                    |
| `npm run typecheck`                              | 通过                                             |
| `npm run build --workspace @test-center/console` | Vite 生产构建通过                                |
| 改动文件 targeted ESLint                         | 通过                                             |
| 改动文件 Prettier                                | 通过                                             |
| H.264 WebCodecs 组件测试                         | 验证串号 WebSocket、解码配置、画布尺寸和绘制回调 |
| SessionsPage 集成测试                            | 验证输入串号后连接主视图并展示解码能力状态       |

## 浏览器视觉证据

- 桌面：`output/playwright/m6-task5-sessions-desktop.png`
- Pixel 7：`output/playwright/m6-task5-sessions-mobile.png`

截图通过系统 Chrome channel 生成，页面地址为 `http://127.0.0.1:5173/#sessions`。两种视口均确认会话空状态、主设备串号区、连接主视图入口和暂停策略可见；移动视口未出现横向溢出。

## 未完成的真实链路验收

- 当前环境的 `adb devices -l` 仍未返回在线设备，无法在本切片内证明真实 Unity 包体的连续 H.264 帧已到达浏览器画布。
- 当前组件默认 codec 为 `avc1.4D0033`，后续应从 scrcpy/设备 SPS 动态推断 profile，避免不同 Android 编码器协商差异。
- 本地截图使用仅运行 Console Vite 的环境，页面状态显示“连接中”是预期结果；真实视频验收需要同时启动服务端和已授权 Android 真机。

## 审批门禁

本记录和对应代码仍处于本地工作区，等待用户确认后再创建提交并推送到远端 `main`。
