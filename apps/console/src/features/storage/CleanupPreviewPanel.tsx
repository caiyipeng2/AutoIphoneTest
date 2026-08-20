import { CircleAlert, CircleDashed, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchCleanupPreview, type CleanupPreviewResponse } from "../../state/api";

const stateLabels: Record<
  CleanupPreviewResponse["preview"]["candidates"][number]["state"],
  string
> = {
  FINISHED: "已完成",
  FAILED: "失败",
  INTERRUPTED: "中断",
  COMPLETED: "已归档",
  FINALIZATION_FAILED: "报告失败",
  ABORTED: "已终止",
};

export function CleanupPreviewPanel({
  retentionDays,
  reloadToken,
}: {
  retentionDays: number;
  reloadToken: number;
}) {
  const [response, setResponse] = useState<CleanupPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setResponse(await fetchCleanupPreview(retentionDays));
    } catch (cause) {
      setResponse(null);
      setError(cause instanceof Error ? cause.message : "无法读取清理预览。");
    } finally {
      setLoading(false);
    }
  }, [retentionDays]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const preview = response?.preview;
  return (
    <section className="panel cleanup-preview-panel" aria-labelledby="cleanup-preview-title">
      <div className="panel-heading cleanup-preview-heading">
        <div>
          <p className="eyebrow">RETENTION / 只读检查</p>
          <h2 id="cleanup-preview-title">清理预览</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title="刷新清理预览"
          aria-label="刷新清理预览"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "spin" : undefined} />
        </button>
      </div>
      <div className="cleanup-preview-safety">
        <ShieldCheck size={15} aria-hidden="true" />
        只读预览，不会执行删除
      </div>
      {loading && (
        <div className="results-feedback" role="status" aria-live="polite">
          <CircleDashed size={16} className="spin" />
          读取清理预览
        </div>
      )}
      {!loading && error && (
        <div className="inline-error results-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          无法读取清理预览：{error}
        </div>
      )}
      {!loading && !error && preview && (
        <>
          <div className="cleanup-preview-summary">
            <div>
              <span>候选运行</span>
              <strong>{preview.candidates.length} 个候选运行</strong>
              <small>截止 {formatDate(preview.cutoffAt)}</small>
            </div>
            <div>
              <span>预计可释放</span>
              <strong>{formatBytes(preview.totalEstimatedBytes)}</strong>
              <small>仅统计 READY 证据与报告</small>
            </div>
          </div>
          {preview.candidates.length === 0 ? (
            <div className="cleanup-preview-empty">
              <HardDrive size={20} aria-hidden="true" />
              <strong>没有符合条件的运行</strong>
              <span>当前保留窗口内没有可清理候选。</span>
            </div>
          ) : (
            <div
              className="table-panel cleanup-preview-table"
              role="table"
              aria-label="清理候选运行"
            >
              <div className="table-head" role="row">
                <span role="columnheader">运行</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">完成时间</span>
                <span role="columnheader">大小</span>
              </div>
              {preview.candidates.map((candidate) => (
                <div className="table-row" role="row" key={candidate.runId}>
                  <strong className="mono" role="cell">
                    {candidate.runId}
                  </strong>
                  <span className="chip chip-warn" role="cell">
                    {stateLabels[candidate.state]}
                  </span>
                  <small role="cell">{formatDate(candidate.completedAt)}</small>
                  <strong role="cell">{formatBytes(candidate.estimatedBytes)}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
