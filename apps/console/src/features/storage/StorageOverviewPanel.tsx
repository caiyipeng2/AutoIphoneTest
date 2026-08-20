import { HardDrive, RefreshCw } from "lucide-react";

import type { StorageOverviewSnapshot } from "../../state/api";
import { DataRow } from "../../components/PageFrame";

const PRESSURE_META = {
  NORMAL: { label: "正常", chip: "chip-good", tone: "good" },
  WARNING: { label: "注意", chip: "chip-warn", tone: "warn" },
  BLOCKED: { label: "阻断新运行", chip: "chip-danger", tone: "danger" },
} as const;

export function StorageOverviewPanel({
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  snapshot: StorageOverviewSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const meta = snapshot === null ? PRESSURE_META.NORMAL : PRESSURE_META[snapshot.pressure];
  return (
    <section className="panel storage-panel" aria-labelledby="storage-overview-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">存储压力</p>
          <h2 id="storage-overview-title">证据空间</h2>
        </div>
        <button
          className="icon-button"
          title="刷新存储状态"
          aria-label="刷新存储状态"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "spin" : undefined} />
        </button>
      </div>
      {loading && snapshot === null ? (
        <div className="panel-state" role="status">
          <HardDrive size={17} />
          正在读取磁盘状态
        </div>
      ) : error !== null && snapshot === null ? (
        <div className="panel-state panel-state-error" role="alert">
          <span>{error}</span>
          <button className="button button-quiet" onClick={onRefresh}>
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      ) : snapshot === null ? (
        <div className="panel-state" role="status">
          <HardDrive size={17} />
          等待存储状态
        </div>
      ) : (
        <>
          <div className="storage-summary">
            <div>
              <span className={`chip ${meta.chip}`}>{meta.label}</span>
              <strong>{formatBytes(snapshot.freeBytes)}</strong>
              <small>当前可用空间</small>
            </div>
            <div className="storage-thresholds">
              <span>警戒线 {formatBytes(snapshot.warningBytes)}</span>
              <span>阻断线 {formatBytes(snapshot.dangerBytes)}</span>
            </div>
          </div>
          <div className="storage-data">
            <DataRow
              label="当前写入速率"
              value={`${formatBytes(snapshot.writeRateBytesPerSecond)}/秒`}
            />
            <DataRow
              label="到阻断阈值"
              value={formatDuration(snapshot.estimatedSecondsUntilBlocked)}
              tone={meta.tone}
            />
            <DataRow
              label="活跃会话影响"
              value={`${snapshot.activeRunCount} 个会话`}
              {...(snapshot.activeRunCount > 0 ? { tone: "warn" } : {})}
            />
          </div>
          {snapshot.sourceError !== undefined && (
            <p className="storage-source-error" role="status">
              磁盘容量暂时不可读，当前状态按阻断策略处理
            </p>
          )}
          <p className="storage-updated">
            采样于 {new Date(snapshot.measuredAt).toLocaleTimeString()}
          </p>
        </>
      )}
    </section>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "不可用";
  const gibibytes = bytes / 1024 ** 3;
  if (gibibytes >= 1) return `${gibibytes.toFixed(1)} GiB`;
  const mebibytes = bytes / 1024 ** 2;
  if (mebibytes >= 1) return `${mebibytes.toFixed(1)} MiB`;
  const kibibytes = bytes / 1024;
  if (kibibytes >= 1) return `${kibibytes.toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "暂无估算";
  if (seconds <= 0) return "已低于阻断线";
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} 天`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)} 小时`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}
