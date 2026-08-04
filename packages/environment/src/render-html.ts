import {
  EnvironmentDiagnosticSchema,
  type EnvironmentDiagnostic,
  type ProbeResult,
} from "@test-center/contracts/environment";

const remediationByCategory: Readonly<Record<string, string>> = {
  ANDROID_MODULE_MISSING: "在 Unity Hub 中补齐 Android Build Support、SDK、NDK 和 OpenJDK。",
  COMMAND_TIMEOUT: "检查工具进程是否卡住，并确认安全软件没有阻止该可执行文件。",
  DATA_ROOT_UNWRITABLE: "检查数据目录权限，确保当前用户可以在 E 盘写入测试证据。",
  DEVICE_LIST_FAILED: "重新连接 USB 设备并检查 ADB 服务状态。",
  DEVICE_STATE_UNAVAILABLE: "让设备回到正常系统并等待 ADB 状态变为 device。",
  DRIVE_NOT_FOUND: "连接或挂载 E 盘后重新运行自检。",
  FREE_SPACE_CRITICAL: "释放 E 盘空间；至少保留 5 GiB 才能继续。",
  FREE_SPACE_LOW: "建议释放 E 盘空间至 20 GiB 以上。",
  NO_DEVICE: "连接 1-4 台已启用 USB 调试的 Android 设备。",
  NO_ONLINE_DEVICE: "在设备上确认 USB 调试授权，并等待 ADB 状态变为 device。",
  NO_PERMISSIONS: "检查 Windows 驱动和当前用户对 Android 设备的访问权限。",
  NO_PORTS_CONFIGURED: "配置 Appium 等本地服务使用的回环端口。",
  NOT_FOUND: "按工具清单安装项目本地版本，或配置已验证的 Unity 内置路径。",
  OFFLINE: "重新插拔 USB 或重启该设备的 ADB 连接。",
  PATH_UNRESOLVED: "配置受信任的绝对路径；PATH 发现结果仅用于诊断，不能直接执行。",
  PORT_OCCUPIED: "关闭占用进程或为测试中心配置其他空闲回环端口。",
  UNAUTHORIZED: "解锁设备并接受此电脑的 USB 调试授权。",
  UNUSABLE_RUNTIME: "检查工具文件完整性及其依赖后重新运行自检。",
  VERSION_MISMATCH: "使用 tools/tool-manifest.json 中固定的版本。",
};

export function renderDiagnosticHtml(
  diagnosticInput: EnvironmentDiagnostic,
  jsonSha256: string,
): string {
  const diagnostic = EnvironmentDiagnosticSchema.parse(diagnosticInput);
  const probeRows = diagnostic.probes.map(renderProbeRow).join("\n");
  const deviceRows = extractDevices(diagnostic)
    .map(
      (device) => `
          <tr>
            <td><code>${escapeHtml(device.serial)}</code></td>
            <td>${escapeHtml(device.model ?? "-")}</td>
            <td><span class="state">${escapeHtml(device.state)}</span></td>
          </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unity 多设备测试中心 - 环境自检</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #202428; background: #f4f6f7; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    header { background: #202428; color: #fff; padding: 22px 28px; }
    header h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    header p { margin: 8px 0 0; color: #cbd2d6; font-size: 13px; }
    main { width: min(1180px, calc(100% - 32px)); margin: 24px auto 40px; }
    .summary { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 18px; align-items: stretch; margin-bottom: 24px; }
    .status { border-radius: 6px; padding: 18px; color: #fff; display: flex; flex-direction: column; justify-content: space-between; min-height: 112px; }
    .status strong { font-size: 24px; }
    .status span { font-size: 12px; opacity: .88; }
    .status-HEALTHY { background: #16724a; }
    .status-DEGRADED { background: #a86400; }
    .status-FATAL { background: #a83232; }
    .metadata { background: #fff; border: 1px solid #d9dee1; border-radius: 6px; padding: 16px 18px; min-width: 0; }
    .metadata dl { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px 12px; margin: 0; }
    dt { color: #657078; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    section { margin-top: 26px; }
    h2 { margin: 0 0 10px; font-size: 17px; letter-spacing: 0; }
    .table-wrap { overflow-x: auto; background: #fff; border: 1px solid #d9dee1; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #e5e9eb; text-align: left; vertical-align: top; }
    th { color: #556068; background: #f8f9fa; font-weight: 600; white-space: nowrap; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .badge { display: inline-block; min-width: 82px; padding: 3px 7px; border-radius: 4px; color: #fff; text-align: center; font-size: 11px; font-weight: 700; }
    .badge-HEALTHY { background: #16724a; }
    .badge-DEGRADED { background: #a86400; }
    .badge-FATAL { background: #a83232; }
    .errors { margin: 0; padding-left: 17px; }
    .errors li + li { margin-top: 8px; }
    .remediation { display: block; margin-top: 3px; color: #59636a; }
    details { margin-top: 8px; }
    summary { color: #53616a; cursor: pointer; }
    pre { margin: 7px 0 0; padding: 10px; background: #f1f3f4; border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { padding: 16px; color: #68737a; }
    .state { white-space: nowrap; }
    @media (max-width: 720px) {
      header { padding: 18px 16px; }
      main { width: min(100% - 20px, 1180px); margin-top: 16px; }
      .summary { grid-template-columns: 1fr; }
      .metadata dl { grid-template-columns: 1fr; }
      dt { margin-top: 5px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Unity 多设备测试中心</h1>
    <p>M0 环境自检报告</p>
  </header>
  <main>
    <div class="summary">
      <div class="status status-${escapeHtml(diagnostic.overall)}">
        <span>总体状态</span>
        <strong>${escapeHtml(diagnostic.overall)}</strong>
      </div>
      <div class="metadata">
        <dl>
          <dt>生成时间</dt><dd>${escapeHtml(diagnostic.generatedAt)}</dd>
          <dt>Schema</dt><dd>${String(diagnostic.schemaVersion)}</dd>
          <dt>JSON SHA-256</dt><dd><code>${escapeHtml(jsonSha256)}</code></dd>
        </dl>
      </div>
    </div>

    <section>
      <h2>环境探针</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>探针</th><th>状态</th><th>版本 / 路径</th><th>耗时</th><th>问题与处理</th></tr></thead>
          <tbody>${probeRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>ADB 设备</h2>
      <div class="table-wrap">
        ${deviceRows.length === 0 ? '<div class="empty">未发现可展示的设备记录。</div>' : `<table><thead><tr><th>Serial</th><th>型号</th><th>状态</th></tr></thead><tbody>${deviceRows}</tbody></table>`}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function renderProbeRow(probe: ProbeResult): string {
  const errors =
    probe.errors.length === 0
      ? "-"
      : `<ul class="errors">${probe.errors
          .map(
            (error) =>
              `<li><strong>${escapeHtml(error.category)}</strong>: ${escapeHtml(error.message)}<span class="remediation">${escapeHtml(remediationByCategory[error.category] ?? "根据错误详情检查该探针的配置和依赖。")}</span></li>`,
          )
          .join("")}</ul>`;
  const identity = [
    probe.version === undefined ? "" : `<div>版本：<code>${escapeHtml(probe.version)}</code></div>`,
    probe.resolvedPath === undefined
      ? ""
      : `<div>路径：<code>${escapeHtml(probe.resolvedPath)}</code></div>`,
  ].join("");
  const facts = escapeHtml(JSON.stringify(probe.facts, null, 2));
  return `
          <tr>
            <td><strong>${escapeHtml(probe.id)}</strong><details><summary>事实</summary><pre>${facts}</pre></details></td>
            <td><span class="badge badge-${escapeHtml(probe.severity)}">${escapeHtml(probe.severity)}</span></td>
            <td>${identity || "-"}</td>
            <td>${String(probe.durationMs)} ms</td>
            <td>${errors}</td>
          </tr>`;
}

interface DeviceView {
  readonly serial: string;
  readonly state: string;
  readonly model?: string;
}

function extractDevices(diagnostic: EnvironmentDiagnostic): DeviceView[] {
  const value: unknown = diagnostic.probes.find((probe) => probe.id === "adb")?.facts.devices;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate): DeviceView[] => {
    if (
      !isRecord(candidate) ||
      typeof candidate.serial !== "string" ||
      typeof candidate.state !== "string"
    ) {
      return [];
    }
    return [
      {
        serial: candidate.serial,
        state: candidate.state,
        ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
