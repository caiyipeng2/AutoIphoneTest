import { escapeHtmlAttribute, escapeHtmlText, toSafeRelativeHref } from "./html-escape.js";
import type {
  ImmutableReportAction,
  ImmutableReportDevice,
  ImmutableReportEvidence,
  ImmutableReportModel,
} from "./report-model.js";

const REPORT_CSS = `
:root {
  color-scheme: light;
  --background: #f5f7f8;
  --surface: #ffffff;
  --surface-muted: #eef2f4;
  --text: #1f2933;
  --muted: #52606d;
  --border: #d9e2ec;
  --success: #15803d;
  --warning: #b45309;
  --danger: #b91c1c;
  --accent: #0f766e;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--background);
  color: var(--text);
  font-family: "Fira Sans", "Segoe UI", Arial, sans-serif;
  line-height: 1.5;
}
.report-shell { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
.report-header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-family: "Fira Code", Consolas, monospace; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: clamp(1.7rem, 4vw, 2.45rem); line-height: 1.15; }
h2 { font-size: 1.05rem; }
.report-meta { margin: 8px 0 0; color: var(--muted); font-family: "Fira Code", Consolas, monospace; font-size: 0.82rem; }
.status { display: inline-flex; align-items: center; min-height: 32px; padding: 4px 10px; border: 1px solid currentColor; border-radius: 999px; font-family: "Fira Code", Consolas, monospace; font-size: 0.78rem; font-weight: 600; }
.status--success { color: var(--success); background: #f0fdf4; }
.status--warning { color: var(--warning); background: #fffbeb; }
.status--danger { color: var(--danger); background: #fef2f2; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.metric { min-width: 0; padding: 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.metric__label { display: block; color: var(--muted); font-size: 0.8rem; }
.metric__value { display: block; margin-top: 4px; font-family: "Fira Code", Consolas, monospace; font-size: 1.55rem; font-weight: 600; }
.panel { margin-top: 18px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); overflow: hidden; }
.panel__header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 15px 16px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
.panel__hint { color: var(--muted); font-size: 0.78rem; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 620px; }
th, td { padding: 11px 16px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { color: var(--muted); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
tbody tr:last-child td { border-bottom: 0; }
code, .mono { font-family: "Fira Code", Consolas, monospace; font-size: 0.84em; overflow-wrap: anywhere; }
.subtle { color: var(--muted); }
.state { font-family: "Fira Code", Consolas, monospace; font-size: 0.78rem; font-weight: 600; }
.state--success { color: var(--success); }
.state--warning { color: var(--warning); }
.state--danger { color: var(--danger); }
.state--muted { color: var(--muted); }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:focus-visible { outline: 3px solid #99f6e4; outline-offset: 3px; }
.empty { padding: 18px 16px; color: var(--muted); }
@media (max-width: 720px) {
  .report-shell { padding: 24px 14px 40px; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-header { align-items: start; }
}
@media print {
  body { background: #fff; }
  .report-shell { max-width: none; padding: 0; }
  .panel, .metric { break-inside: avoid; }
  a { color: inherit; }
}
`.trim();

/** Renders a dependency-free, network-free HTML snapshot from an immutable model. */
export function renderOfflineReport(model: ImmutableReportModel): string {
  const failedActions = model.actions.filter((action) => action.state === "FAILED").length;
  const failedEvidence = model.evidence.filter((entry) => entry.state === "FAILED").length;
  const missingEvidence = model.evidence.filter((entry) => entry.state === "MISSING").length;
  const statusClass = statusClassForRun(model.run.state);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
    <title>${escapeHtmlText(model.run.packageName)} - ${escapeHtmlText(model.run.id)}</title>
    <style id="inline-style">${REPORT_CSS}</style>
  </head>
  <body>
    <main class="report-shell">
      <header class="report-header">
        <div>
          <p class="eyebrow">Unity Multi-Device Test Center / Offline Result</p>
          <h1>${escapeHtmlText(model.run.packageName)}</h1>
          <p class="report-meta">run <span class="mono">${escapeHtmlText(model.run.id)}</span> · epoch ${model.run.currentEpoch}</p>
        </div>
        <span class="status ${statusClass}">${escapeHtmlText(model.run.state)}</span>
      </header>

      <section class="summary-grid" aria-label="Run summary">
        ${metric("Devices", model.devices.length)}
        ${metric("Actions", model.actions.length)}
        ${metric("Action failures", failedActions)}
        ${metric("Evidence gaps", failedEvidence + missingEvidence)}
      </section>

      ${renderDevices(model.devices)}
      ${renderActions(model.actions)}
      ${renderIncidents(model.incidents)}
      ${renderRecoveries(model.recoveries)}
      ${renderEvidence(model.evidence)}
    </main>
  </body>
</html>
`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><span class="metric__label">${escapeHtmlText(label)}</span><strong class="metric__value">${value}</strong></div>`;
}

function renderDevices(devices: readonly ImmutableReportDevice[]): string {
  const rows = devices
    .map(
      (device) => `<tr>
        <td class="mono">${escapeHtmlText(device.serial)}</td>
        <td>${escapeHtmlText(device.uid ?? "Not recorded")}</td>
        <td>${escapeHtmlText(device.role)}</td>
        <td><span class="state ${stateClass(device.membershipState)}">${escapeHtmlText(device.membershipState)}</span></td>
        <td class="mono">${device.generation}</td>
      </tr>`,
    )
    .join("");
  return section(
    "Device matrix",
    `${devices.length} connected test member${devices.length === 1 ? "" : "s"}`,
    rows.length === 0
      ? `<p class="empty">No device membership was recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Serial</th><th scope="col">UID</th><th scope="col">Role</th><th scope="col">Membership</th><th scope="col">Generation</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

function renderActions(actions: readonly ImmutableReportAction[]): string {
  const rows = actions
    .map((action) => {
      const targets = action.targets
        .map(
          (target) =>
            `<span class="mono">${escapeHtmlText(target.serial)}</span>: ${renderState(target.state)}`,
        )
        .join("<br>");
      return `<tr>
        <td class="mono">${action.actionSeq}</td>
        <td>${escapeHtmlText(action.label ?? action.type)}</td>
        <td><span class="state ${stateClass(action.state)}">${escapeHtmlText(action.state)}</span></td>
        <td>${targets || `<span class="subtle">No targets</span>`}</td>
      </tr>`;
    })
    .join("");
  return section(
    "Action timeline",
    `${actions.length} recorded action${actions.length === 1 ? "" : "s"}`,
    rows.length === 0
      ? `<p class="empty">No actions were recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Seq</th><th scope="col">Action</th><th scope="col">Run state</th><th scope="col">Targets</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

function renderEvidence(evidence: readonly ImmutableReportEvidence[]): string {
  const rows = evidence
    .map((entry) => {
      const detail =
        entry.state === "READY" && entry.finalRelativePath !== undefined
          ? `<a href="${escapeHtmlAttribute(toSafeRelativeHref(entry.finalRelativePath))}">Open evidence</a>`
          : entry.unavailableReason !== undefined
            ? `<span class="subtle">${escapeHtmlText(entry.unavailableReason)}</span>`
            : entry.errorCategory !== undefined
              ? `<span class="subtle">${escapeHtmlText(entry.errorCategory)}</span>`
              : `<span class="subtle">No published file</span>`;
      return `<tr>
        <td class="mono">${escapeHtmlText(entry.id)}</td>
        <td>${escapeHtmlText(entry.kind)}</td>
        <td><span class="state ${stateClass(entry.state)}">${escapeHtmlText(entry.state)}</span></td>
        <td>${detail}</td>
      </tr>`;
    })
    .join("");
  return section(
    "Evidence readiness",
    `${evidence.length} evidence record${evidence.length === 1 ? "" : "s"}`,
    rows.length === 0
      ? `<p class="empty">No evidence records were recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Evidence ID</th><th scope="col">Kind</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

function renderIncidents(incidents: ImmutableReportModel["incidents"]): string {
  const rows = incidents
    .map((incident) => {
      const details = Object.entries(incident.details)
        .map(
          ([key, value]) =>
            `<span class="mono">${escapeHtmlText(key)}</span>: ${escapeHtmlText(value)}`,
        )
        .join("<br>");
      return `<tr>
        <td class="mono">${escapeHtmlText(incident.incidentId)}</td>
        <td><span class="state ${incidentClass(incident.category)}">${escapeHtmlText(incident.category)}</span></td>
        <td>${escapeHtmlText(incident.serial ?? "Run-wide")}</td>
        <td>${escapeHtmlText(incident.source)}${details ? `<br><span class="subtle">${details}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return section(
    "Incident log",
    `${incidents.length} incident${incidents.length === 1 ? "" : "s"}`,
    rows.length === 0
      ? `<p class="empty">No incidents were recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Incident ID</th><th scope="col">Category</th><th scope="col">Device</th><th scope="col">Source / details</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

function renderRecoveries(recoveries: ImmutableReportModel["recoveries"]): string {
  const rows = recoveries
    .map(
      (recovery) => `<tr>
        <td class="mono">${escapeHtmlText(recovery.id)}</td>
        <td>${escapeHtmlText(recovery.action)}</td>
        <td>${escapeHtmlText(recovery.targetSerial ?? "All devices")}</td>
        <td><span class="state ${stateClass(recovery.status)}">${escapeHtmlText(recovery.status)}</span></td>
        <td>${escapeHtmlText(recovery.errorMessage ?? recovery.reason)}</td>
      </tr>`,
    )
    .join("");
  return section(
    "Recovery attempts",
    `${recoveries.length} attempt${recoveries.length === 1 ? "" : "s"}`,
    rows.length === 0
      ? `<p class="empty">No recovery attempts were recorded.</p>`
      : `<div class="table-wrap"><table><thead><tr><th scope="col">Attempt ID</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Reason / error</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

function section(title: string, hint: string, body: string): string {
  return `<section class="panel"><div class="panel__header"><h2>${escapeHtmlText(title)}</h2><span class="panel__hint">${escapeHtmlText(hint)}</span></div>${body}</section>`;
}

function renderState(value: string): string {
  return `<span class="state ${stateClass(value)}">${escapeHtmlText(value)}</span>`;
}

function statusClassForRun(state: string): string {
  return state === "FINISHED"
    ? "status--success"
    : state === "FAILED"
      ? "status--danger"
      : "status--warning";
}

function stateClass(state: string): string {
  if (["SUCCEEDED", "READY", "ACTIVE", "FINISHED"].includes(state)) return "state--success";
  if (["PENDING", "QUEUED", "DISPATCHING", "RECOVERING", "INTERRUPTED"].includes(state)) {
    return "state--warning";
  }
  if (["FAILED", "MISSING", "CANCELLED", "QUARANTINED"].includes(state)) return "state--danger";
  return "state--muted";
}

function incidentClass(category: string): string {
  return category === "LOW_DISK" || category === "METRICS_CHANGED"
    ? "state--warning"
    : "state--danger";
}
