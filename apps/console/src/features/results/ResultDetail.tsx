import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  RefreshCw,
  Smartphone,
} from "lucide-react";

import type { ReportHistoryItem } from "../../state/api";

export function ResultDetail({
  result,
  onBack,
  onRetryFinalization,
  retryingFinalization,
  retryFinalizationError,
}: {
  result: ReportHistoryItem;
  onBack: () => void;
  onRetryFinalization?: () => void;
  retryingFinalization?: boolean;
  retryFinalizationError?: string | undefined;
}) {
  const stateLabel =
    result.state === "FINISHED" ? "已完成" : result.state === "FAILED" ? "失败" : "已中断";
  const stateTone =
    result.state === "FINISHED"
      ? "chip-good"
      : result.state === "FAILED"
        ? "chip-danger"
        : "chip-warn";
  const output = describeExports(result);

  return (
    <div className="results-detail" aria-label={`报告详情 ${result.runId}`}>
      <div className="results-detail-heading">
        <button
          className="icon-button"
          type="button"
          aria-label="返回报告历史"
          title="返回报告历史"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <p className="eyebrow">RESULT DETAIL / READ ONLY</p>
          <h2>报告详情</h2>
          <p className="results-detail-run">{result.runId}</p>
        </div>
        <span className={`chip ${stateTone} results-detail-state`}>
          {result.state === "FINISHED" ? <CheckCircle2 size={12} /> : <CircleX size={12} />}
          {stateLabel}
        </span>
      </div>

      <div className="results-detail-summary">
        <div>
          <span>Unity 游戏包</span>
          <strong>{result.packageName}</strong>
        </div>
        <div>
          <span>当前 Epoch</span>
          <strong>{result.currentEpoch}</strong>
        </div>
        <div>
          <span>默认输出</span>
          <strong className={`results-output ${output.tone}`}>{output.label}</strong>
        </div>
      </div>

      <section className="results-detail-section" aria-labelledby="results-devices-title">
        <div className="results-detail-section-heading">
          <div>
            <p className="eyebrow">MEMBERS / UID</p>
            <h3 id="results-devices-title">设备身份</h3>
          </div>
          <span className="toolbar-note">
            <Smartphone size={14} />
            {result.devices.length} 台设备
          </span>
        </div>
        <div className="results-detail-devices">
          {result.devices.map((device) => (
            <div className="results-detail-device" key={`${device.role}-${device.serial}`}>
              <Smartphone size={16} />
              <div>
                <strong>{device.serial}</strong>
                <span>{device.role === "LEADER" ? "LEADER" : "FOLLOWER"}</span>
              </div>
              <code>{device.uid ?? "UID 未回写"}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="results-detail-section" aria-labelledby="results-exports-title">
        <div className="results-detail-section-heading">
          <div>
            <p className="eyebrow">EXPORTS / EVIDENCE</p>
            <h3 id="results-exports-title">报告输出</h3>
          </div>
        </div>
        <div className="results-detail-exports">
          {result.exports.length === 0 ? (
            <div className="results-detail-empty">
              <CircleAlert size={15} />
              <span>当前记录没有输出条目。</span>
            </div>
          ) : (
            result.exports.map((reportExport) => (
              <div className="results-detail-export" key={reportExport.id}>
                {reportExport.format === "HTML" ? (
                  <FileCode2 size={16} />
                ) : (
                  <FileArchive size={16} />
                )}
                <div>
                  <strong>{reportExport.format}</strong>
                  <span>{exportStateLabel[reportExport.state]}</span>
                </div>
                <code>{reportExport.sha256 ?? "等待校验哈希"}</code>
                {reportExport.state === "READY" && reportExport.finalRelativePath !== undefined && (
                  <div className="results-detail-export-actions">
                    {reportExport.format === "HTML" ? (
                      <a
                        className="button button-quiet"
                        href={`/api/results/${encodeURIComponent(result.runId)}/exports/HTML`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} />
                        打开 HTML
                      </a>
                    ) : (
                      <a
                        className="button button-quiet"
                        href={`/api/results/${encodeURIComponent(result.runId)}/exports/ZIP`}
                        download
                      >
                        <Download size={14} />
                        下载 ZIP
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {result.finalization && (
        <div className="results-detail-finalization" role="status">
          <CircleDashed size={15} />
          <span>最终化状态：{finalizationStateLabel[result.finalization.state]}</span>
          <span>第 {result.finalization.attempt} 次尝试</span>
          {(result.finalization.state === "FINALIZATION_FAILED" ||
            result.finalization.state === "INTERRUPTED") &&
            onRetryFinalization !== undefined && (
              <div className="results-detail-finalization-actions">
                {retryFinalizationError !== undefined && (
                  <span className="results-detail-finalization-error" role="alert">
                    {retryFinalizationError}
                  </span>
                )}
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={onRetryFinalization}
                  disabled={retryingFinalization}
                >
                  <RefreshCw size={14} className={retryingFinalization ? "spin" : undefined} />
                  {retryingFinalization ? "正在重试" : "重试报告生成"}
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

const exportStateLabel = {
  PENDING: "等待生成",
  READY: "已就绪",
  FAILED: "生成失败",
  MISSING: "缺失",
} as const;

const finalizationStateLabel = {
  FINALIZING: "生成中",
  COMPLETED: "已完成",
  FINALIZATION_FAILED: "生成失败",
  ABORTED: "已终止",
  INTERRUPTED: "已中断",
} as const;

function describeExports(result: ReportHistoryItem): { label: string; tone: string } {
  const exportsByFormat = new Map(result.exports.map((item) => [item.format, item.state]));
  if (exportsByFormat.get("HTML") === "READY" && exportsByFormat.get("ZIP") === "READY") {
    return { label: "HTML + ZIP 已就绪", tone: "is-ready" };
  }
  if (
    [...exportsByFormat.values()].some((state) => state === "FAILED" || state === "MISSING") ||
    result.finalization?.state === "FINALIZATION_FAILED"
  ) {
    return { label: "输出不完整", tone: "is-failed" };
  }
  if (result.finalization?.state === "FINALIZING") {
    return { label: "报告生成中", tone: "is-pending" };
  }
  return { label: "待生成", tone: "is-pending" };
}
