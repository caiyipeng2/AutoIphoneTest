# M1 验收记录

## 完成范围

- React 控制台：总览、设备、应用、构建、会话、报告、设置七个工作页。
- 本地服务同端口挂载控制台 dist，启动器只打开 `127.0.0.1`，bootstrap code 一次性消费。
- WinForms 启动器：单实例、Node 22.23.1 子进程、stdin 长度帧、就绪 HMAC 校验、停止服务。
- Playwright：页面可达、刷新恢复、桌面/移动布局、Host/Origin/CSRF/重复 code 拒绝。

## 验收命令

```powershell
& .\tools\node\22.23.1\npm.cmd run typecheck
& .\tools\node\22.23.1\npm.cmd test -- --reporter=dot
& .\tools\node\22.23.1\npm.cmd run build --workspace @test-center/console
dotnet build .\apps\launcher\src\TestCenter.Launcher\TestCenter.Launcher.csproj -c Release
& .\scripts\provision-playwright.ps1
& .\tools\node\22.23.1\npx.cmd playwright test
```

## 结果

- Vitest：12 个测试文件、84 个测试通过。
- TypeScript：通过。
- Console Vite production build：通过。
- WinForms Release build：通过。
- Playwright 输出写入 `output/playwright/`，浏览器缓存写入 `data/tools/ms-playwright/`。

## 已知边界

- M1 的设置状态仍保留在当前服务进程内；SQLite 持久化接入列入后续 M2，不影响本阶段 bootstrap、页面和安全边界验收。
