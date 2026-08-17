import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  FileCheck2,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageFrame } from "../components/PageFrame";
import { ResultDetail } from "../features/results/ResultDetail";
import {
  fetchResultDetail,
  fetchResults,
  type ReportHistoryItem,
  type ReportRunState,
} from "../state/api";

type ResultsFilter = "ALL" | ReportRunState;

const stateLabels: Record<ResultsFilter, string> = {
  ALL: "全部状态",
  FINISHED: "仅显示完成",
  FAILED: "仅显示失败",
  INTERRUPTED: "仅显示中断",
};

export function ResultsPage() {
  const [results, setResults] = useState<ReportHistoryItem[]>([]);
  const [filter, setFilter] = useState<ResultsFilter>("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportHistoryItem | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | undefined>();

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setResults(await fetchResults({ limit: 50 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取报告历史。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const openDetail = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    try {
      setDetail(await fetchResultDetail(runId));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "无法读取报告详情。");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedRunId(null);
    setDetail(undefined);
    setDetailError(undefined);
  }, []);

  const visibleResults = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return results.filter((result) => {
      if (filter !== "ALL" && result.state !== filter) return false;
      if (normalizedQuery === "") return true;
      const searchable = [
        result.runId,
        result.packageName,
        ...result.devices.flatMap((device) => [device.serial, device.uid ?? ""]),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [filter, query, results]);

  return (
    <PageFrame title="报告" eyebrow="RESULTS / 证据输出">
      {selectedRunId !== null ? (
        <>
          {detailLoading && (
            <div className="results-feedback" role="status" aria-live="polite">
              <CircleDashed size={16} className="spin" />
              正在读取报告详情
            </div>
          )}
          {detailError !== undefined && !detailLoading && (
            <div className="inline-error results-error" role="alert">
              <CircleAlert size={16} />
              <span>{detailError}</span>
              <button className="button button-quiet" type="button" onClick={closeDetail}>
                返回报告历史
              </button>
            </div>
          )}
          {!detailLoading && detailError === undefined && detail !== undefined && (
            <ResultDetail result={detail} onBack={closeDetail} />
          )}
        </>
      ) : (
        <>
          <div className="toolbar results-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                type="search"
                aria-label="搜索报告历史"
                placeholder="搜索会话、包名或 UID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="results-filter">
              <Filter size={14} />
              <span>状态</span>
              <select
                aria-label="报告状态"
                value={filter}
                onChange={(event) => setFilter(event.target.value as ResultsFilter)}
              >
                {Object.entries(stateLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="toolbar-spacer" />
            <span className="toolbar-note">
              <FileCheck2 size={14} />
              {results.length === 0
                ? "暂无历史"
                : `${visibleResults.length} / ${results.length} 条记录`}
            </span>
            <button
              className="button button-quiet"
              type="button"
              aria-label="刷新报告历史"
              title="重新读取报告历史"
              onClick={() => void loadResults()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
              重新读取
            </button>
          </div>

          {loading && (
            <div className="results-feedback" role="status" aria-live="polite">
              <CircleDashed size={16} className="spin" />
              正在读取报告历史
            </div>
          )}

          {error !== undefined && !loading && (
            <div className="inline-error results-error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => void loadResults()}
              >
                重新读取
              </button>
            </div>
          )}

          {!loading && error === undefined && results.length === 0 && (
            <div className="panel">
              <div className="empty-state">
                <FileCheck2 size={32} />
                <h2>还没有可查看的报告</h2>
                <p>完成一次终态会话后，HTML 与 ZIP 会出现在这里。</p>
              </div>
            </div>
          )}

          {!loading && error === undefined && results.length > 0 && visibleResults.length === 0 && (
            <div className="panel">
              <div className="empty-state">
                <Search size={32} />
                <h2>没有匹配的报告</h2>
                <p>调整状态或搜索条件后重试。</p>
              </div>
            </div>
          )}

          {!loading && error === undefined && visibleResults.length > 0 && (
            <div className="table-panel results-table" role="table" aria-label="报告历史">
              <div className="table-head" role="row">
                <span>运行 / 包体</span>
                <span>设备 / UID</span>
                <span>状态</span>
                <span>默认输出</span>
                <span>更新时间</span>
              </div>
              {visibleResults.map((result) => (
                <ResultRow key={result.runId} result={result} onOpen={openDetail} />
              ))}
            </div>
          )}
        </>
      )}
    </PageFrame>
  );
}

function ResultRow({
  result,
  onOpen,
}: {
  result: ReportHistoryItem;
  onOpen: (runId: string) => void;
}) {
  const stateLabel =
    result.state === "FINISHED" ? "已完成" : result.state === "FAILED" ? "失败" : "已中断";
  const stateClass =
    result.state === "FINISHED"
      ? "chip-good"
      : result.state === "FAILED"
        ? "chip-danger"
        : "chip-warn";
  const output = describeExports(result);

  return (
    <div className="table-row" role="row">
      <div className="results-run" role="cell">
        <button
          className="results-run-button"
          type="button"
          title={`查看报告 ${result.runId}`}
          aria-label={`查看报告 ${result.runId}`}
          onClick={() => onOpen(result.runId)}
        >
          <strong>{result.runId}</strong>
        </button>
        <small>{result.packageName}</small>
        <small>Epoch {result.currentEpoch}</small>
      </div>
      <div className="results-device-stack" role="cell">
        {result.devices.slice(0, 2).map((device) => (
          <span className="results-device" key={`${result.runId}-${device.serial}`}>
            {device.serial}
            {device.uid === undefined ? "" : ` · ${device.uid}`}
          </span>
        ))}
        {result.devices.length > 2 && (
          <small className="results-device-more">+{result.devices.length - 2} 台设备</small>
        )}
      </div>
      <div role="cell">
        <span className={`chip ${stateClass} results-state`}>
          {result.state === "FINISHED" ? <CheckCircle2 size={12} /> : <CircleX size={12} />}
          {stateLabel}
        </span>
      </div>
      <div className={`results-output ${output.tone}`} role="cell">
        {output.label}
      </div>
      <time className="results-updated" dateTime={result.updatedAt} role="cell">
        {formatDate(result.updatedAt)}
      </time>
    </div>
  );
}

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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
