import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchIncidentTimeline, type IncidentTimeline as TimelineData } from "../../state/api";

const categoryLabels: Record<TimelineData["incidents"][number]["category"], string> = {
  ADB_DISCONNECTED: "ADB 连接中断",
  APPIUM_SESSION_LOST: "Appium 会话丢失",
  APP_CRASH_OR_ANR: "游戏崩溃 / ANR",
  WRONG_FOREGROUND: "前台包名错误",
  BRIDGE_TIMEOUT: "Bridge 超时",
  BRIDGE_STATE_MISMATCH: "Bridge 状态不一致",
  TEXT_FOCUS_MISMATCH: "文本焦点不一致",
  METRICS_CHANGED: "画面指标变化",
  LOW_DISK: "磁盘空间不足",
};

export function IncidentTimeline({ sessionId }: { sessionId: string }) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<
    "ALL" | TimelineData["incidents"][number]["category"]
  >("ALL");
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void fetchIncidentTimeline(sessionId)
      .then((value) => {
        setTimeline(value);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "故障记录读取失败"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [sessionId]);

  const recoveriesByIncident = useMemo(
    () => new Map((timeline?.recoveries ?? []).map((recovery) => [recovery.incidentId, recovery])),
    [timeline],
  );
  const filteredIncidents = useMemo(
    () =>
      (timeline?.incidents ?? []).filter(
        (incident) => categoryFilter === "ALL" || incident.category === categoryFilter,
      ),
    [categoryFilter, timeline],
  );

  return (
    <section className="panel session-timeline-panel" aria-labelledby="incident-timeline-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">INCIDENT TIMELINE / READ ONLY</p>
          <h2 id="incident-timeline-title">故障时间线</h2>
        </div>
        <button
          className="icon-button"
          title="刷新故障记录"
          aria-label="刷新故障记录"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : undefined} size={17} />
        </button>
      </div>
      {loading && (
        <div className="timeline-empty">
          <Clock3 size={17} />
          <span>正在读取故障记录…</span>
        </div>
      )}
      {!loading && error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={15} />
          {error}
        </div>
      )}
      {!loading && !error && timeline?.incidents.length === 0 && (
        <div className="timeline-empty">
          <CircleCheck size={17} />
          <span>当前会话没有故障记录。</span>
        </div>
      )}
      {!loading && !error && timeline && timeline.incidents.length > 0 && (
        <>
          <div className="incident-timeline-filters">
            <label>
              <span>故障类别</span>
              <select
                aria-label="故障类别"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
              >
                <option value="ALL">全部故障</option>
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="incident-timeline-count">{filteredIncidents.length} 条记录</span>
          </div>
          {filteredIncidents.length === 0 && (
            <div className="timeline-empty">
              <CircleCheck size={17} />
              <span>没有符合筛选条件的故障。</span>
            </div>
          )}
        </>
      )}
      {!loading && !error && timeline && filteredIncidents.length > 0 && (
        <div className="incident-timeline-list">
          {filteredIncidents.map((incident) => {
            const recovery = recoveriesByIncident.get(incident.incidentId);
            const expanded = expandedIncidentId === incident.incidentId;
            return (
              <article className="incident-timeline-item" key={incident.incidentId}>
                <span className="incident-timeline-marker">
                  <ShieldAlert size={15} />
                </span>
                <div className="incident-timeline-content">
                  <div className="incident-timeline-head">
                    <strong>{categoryLabels[incident.category]}</strong>
                    <time dateTime={incident.detectedAt}>{formatTime(incident.detectedAt)}</time>
                  </div>
                  <div className="incident-timeline-meta">
                    <span>{incident.serial ?? "运行级故障"}</span>
                    <span>{incident.source}</span>
                    {incident.generation !== undefined && <span>代次 {incident.generation}</span>}
                  </div>
                  <p>
                    {incident.details.message ??
                      incident.details.connectionState ??
                      "检测到运行时故障"}
                  </p>
                  <button
                    className="incident-detail-toggle"
                    aria-label={`${expanded ? "收起" : "展开"}故障详情 ${incident.incidentId}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedIncidentId(expanded ? null : incident.incidentId)}
                  >
                    <ChevronDown size={14} />
                    {expanded ? "收起详情" : "查看详情"}
                  </button>
                  {expanded && (
                    <dl className="incident-detail-grid">
                      {incident.evidenceRef && (
                        <>
                          <dt>证据引用</dt>
                          <dd>{incident.evidenceRef}</dd>
                        </>
                      )}
                      {Object.entries(incident.details).map(([key, value]) => (
                        <ReactDetail key={key} label={key} value={value} />
                      ))}
                    </dl>
                  )}
                  {recovery && (
                    <div className="incident-recovery-row">
                      <span
                        className={`chip ${recovery.status === "SUCCEEDED" ? "chip-good" : recovery.status === "FAILED" ? "chip-danger" : "chip-warn"}`}
                      >
                        {recoveryStatusLabel[recovery.status]}
                      </span>
                      <span>
                        {recovery.action === "PAUSE_ALL"
                          ? "全组暂停"
                          : `隔离 ${recovery.targetSerial ?? "设备"}`}
                      </span>
                      {recovery.errorMessage && (
                        <span className="incident-recovery-error">{recovery.errorMessage}</span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReactDetail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{`${label}：${value}`}</dd>
    </>
  );
}

const recoveryStatusLabel = { STARTED: "处理中", SUCCEEDED: "已处理", FAILED: "处理失败" } as const;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
