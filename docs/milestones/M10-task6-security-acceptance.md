# M10 Task 6 - 报告安全与完整性矩阵验收记录

## 本切片范围

- 离线 HTML 注入 hostile SVG/IMG、事件属性、外部 URL、Unicode 路径和公式样式文本，验证 HTML 转义、相对链接约束、CSP 和无外部资源引用。
- 对 logcat 中的 token、CSRF、keystore password、JSON 字符串 secret 和动作文本执行发布前脱敏，验证明文不进入报告输出。
- 验证 ZIP publisher 强制 ZIP64、Unicode entry、manifest hash/size 和 64 位安全大小元数据；manifest 同时拒绝路径碰撞和重复 `associationId`。

## 验证结果

- `tests/security/report-output.test.ts`：3 个安全矩阵测试通过。
- ZIP manifest、ZIP publisher、ZIP verifier 回归：12 个测试通过；安全定向合计 `15/15` 通过。
- 生产修复：`createZipManifest` 现在拒绝 `report-html` 保留 ID 和重复 evidence association ID，避免报告条目关联歧义。
- 4 GiB+ 场景以 64 位安全 `sizeBytes` 元数据和强制 ZIP64 归档签名进行确定性模拟，未分配超大内存或写入超大测试文件。

## 后续边界

- 本切片不包含 Excel/PDF/JUnit 输出，因此公式样式输入只验证 HTML 纯文本转义，不宣称电子表格公式中和功能。
- 离线 Playwright 网络阻断、截图布局检查和完整 M10 总验收仍待后续切片。
- 当前改动仅保留在本地，待用户确认后再提交并推送远端 `main`。
