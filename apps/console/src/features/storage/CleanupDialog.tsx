import { AlertTriangle, CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  executeCleanup,
  fetchCleanupEvents,
  issueCleanupConfirmation,
  type CleanupAuditEvent,
  type CleanupExecutionResult,
  type CleanupPreviewCandidate,
} from "../../state/api";

export function CleanupDialog({
  candidates,
  onClose,
}: {
  candidates: CleanupPreviewCandidate[];
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<"CONFIRM" | "EXECUTING" | "RESULT">("CONFIRM");
  const [result, setResult] = useState<CleanupExecutionResult | null>(null);
  const [events, setEvents] = useState<CleanupAuditEvent[]>([]);
  const [error, setError] = useState<string>();
  const totalBytes = useMemo(
    () => candidates.reduce((total, candidate) => total + candidate.estimatedBytes, 0),
    [candidates],
  );
  const runIds = useMemo(() => candidates.map((candidate) => candidate.runId), [candidates]);
  const busy = phase === "EXECUTING";

  const runCleanup = async () => {
    if (!acknowledged || busy) return;
    setPhase("EXECUTING");
    setError(undefined);
    try {
      const confirmation = await issueCleanupConfirmation(runIds, totalBytes);
      const cleanupId = createCleanupId();
      const cleanupResult = await executeCleanup({
        cleanupId,
        nonce: confirmation.nonce,
        runIds,
        expectedBytes: totalBytes,
      });
      setResult(cleanupResult);
      try {
        const audit = await fetchCleanupEvents(cleanupResult.cleanupId);
        setEvents(audit.events);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "审计事件暂不可用。");
      }
      setPhase("RESULT");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理执行失败。");
      setPhase("CONFIRM");
    }
  };

  return (
    <div className="modal-scrim" role="presentation">
      <section
        className="cleanup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-dialog-title"
      >
        <div className="cleanup-dialog-heading">
          <div>
            <p className="eyebrow">DESTRUCTIVE ACTION / 需要确认</p>
            <h2 id="cleanup-dialog-title">{result === null ? "确认清理" : "清理结果"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        {result === null ? (
          <>
            <div className="cleanup-dialog-warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>清理会永久删除已移入回收站的运行证据</strong>
                <span>服务端会先校验一次性确认 nonce，再移动并删除指定运行目录。</span>
              </div>
            </div>
            <div className="cleanup-dialog-summary">
              <div>
                <span>选中运行</span>
                <strong>{candidates.length} 个</strong>
              </div>
              <div>
                <span>预计释放</span>
                <strong>{formatBytes(totalBytes)}</strong>
              </div>
            </div>
            <div className="cleanup-dialog-runs" aria-label="待清理运行">
              {candidates.map((candidate) => (
                <div className="cleanup-dialog-run" key={candidate.runId}>
                  <span className="mono">{candidate.runId}</span>
                  <strong>{formatBytes(candidate.estimatedBytes)}</strong>
                </div>
              ))}
            </div>
            <label className="cleanup-dialog-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                aria-label={`确认清理 ${runIds.join(" 和 ")}`}
              />
              <span>我已核对以上运行和预计空间，确认执行清理</span>
            </label>
            {error !== undefined && (
              <div className="inline-error cleanup-dialog-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" />
                {error}
              </div>
            )}
            <div className="cleanup-dialog-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => void runCleanup()}
                disabled={!acknowledged || busy}
              >
                {busy ? <LoaderCircle className="spin" size={15} /> : <AlertTriangle size={15} />}
                确认执行清理
              </button>
            </div>
          </>
        ) : (
          <CleanupResult result={result} events={events} error={error} onClose={onClose} />
        )}
      </section>
    </div>
  );
}

function CleanupResult({
  result,
  events,
  error,
  onClose,
}: {
  result: CleanupExecutionResult;
  events: CleanupAuditEvent[];
  error: string | undefined;
  onClose: () => void;
}) {
  const recovery = result.state === "RECOVERY_REQUIRED";
  return (
    <>
      <div
        className={`cleanup-result-banner ${recovery ? "is-recovery" : "is-success"}`}
        role={recovery ? "alert" : "status"}
      >
        {recovery ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}
        <div>
          <strong>{recovery ? "清理需要恢复" : "清理已完成"}</strong>
          <span>
            {recovery
              ? "部分文件未能完成删除，运行状态和审计记录已保留。"
              : "选中的运行目录已完成移动、删除和状态记录。"}
          </span>
        </div>
      </div>
      <div className="cleanup-result-summary">
        <span>
          清理编号 <strong className="mono">{result.cleanupId}</strong>
        </span>
        <span>已删除 {result.deleted.length} 个</span>
        <span>已恢复 {result.restored.length} 个</span>
        <span>未解决 {result.unresolved.length} 个</span>
      </div>
      {result.unresolved.length > 0 && (
        <div className="cleanup-result-unresolved">
          <strong>未解决运行</strong>
          <span>{result.unresolved.join("、")}</span>
        </div>
      )}
      {result.errorMessage !== undefined && (
        <p className="cleanup-result-error">{result.errorMessage}</p>
      )}
      {error !== undefined && (
        <div className="inline-error cleanup-dialog-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          无法读取完整审计事件：{error}
        </div>
      )}
      <div className="cleanup-audit-list" aria-label="清理审计事件">
        <div className="cleanup-audit-header">
          <strong>审计时间线</strong>
          <span>已记录 {events.length} 条审计事件</span>
        </div>
        {events.map((event) => (
          <div className="cleanup-audit-event" key={event.sequence}>
            <span className="mono">#{event.sequence}</span>
            <strong>{eventLabel(event.kind)}</strong>
            <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
            {event.runId !== undefined && <span className="mono">{event.runId}</span>}
            {event.errorMessage !== undefined && (
              <span className="cleanup-audit-error">{event.errorMessage}</span>
            )}
          </div>
        ))}
      </div>
      <div className="cleanup-dialog-actions">
        <button className="button button-primary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </>
  );
}

function eventLabel(kind: CleanupAuditEvent["kind"]): string {
  return {
    STARTED: "开始清理",
    RUN_MOVED: "运行已移入回收站",
    RUN_RESTORED: "运行已恢复",
    MOVE_FAILED: "移动失败",
    COMPLETED: "清理完成",
    ROLLED_BACK: "已回滚并需恢复",
  }[kind];
}

function createCleanupId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `cleanup-${random ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
