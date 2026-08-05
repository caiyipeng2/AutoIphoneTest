import { Copy, Package, Smartphone } from "lucide-react";

import type { ArtifactRecord } from "./artifact-api";

interface ArtifactTableProps {
  artifacts: ArtifactRecord[];
  onCopyHash: (hash: string) => void;
}

export function ArtifactTable({ artifacts, onCopyHash }: ArtifactTableProps) {
  return (
    <div className="table-panel artifact-table" data-testid="artifact-table">
      <div className="table-head">
        <span>制品 / 类型</span>
        <span>包名 / 版本</span>
        <span>签名 / 设备</span>
        <span>时间 / 大小</span>
        <span>SHA-256</span>
      </div>
      {artifacts.map((artifact) => {
        const installed = artifact.kind === "INSTALLED";
        const hash = installed ? artifact.installedSetSha256 : artifact.sha256;
        return (
          <div className="table-row" key={artifact.id}>
            <div className="artifact-kind">
              {installed ? <Smartphone size={16} /> : <Package size={16} />}
              <div>
                <strong>{installed ? "已安装版本" : artifact.originalName}</strong>
                <small>{artifact.kind}</small>
              </div>
            </div>
            <div>
              <strong>{artifact.packageName ?? "未解析包名"}</strong>
              <small>
                v{artifact.versionName ?? "--"} · {artifact.versionCode ?? "--"}
              </small>
            </div>
            <div>
              <strong className="mono">{shortHash(artifact.signerSha256)}</strong>
              <small>{installed ? `UID · ${artifact.deviceSerial}` : "签名摘要"}</small>
            </div>
            <div>
              <strong>{formatTime(installed ? artifact.observedAt : artifact.createdAt)}</strong>
              <small>{installed ? "观察时间" : formatBytes(artifact.sizeBytes)}</small>
            </div>
            <button
              className="hash-button"
              title="复制 SHA-256"
              aria-label={`复制 ${installed ? "安装集" : "文件"} SHA-256`}
              onClick={() => onCopyHash(hash)}
            >
              <span className="mono">{shortHash(hash)}</span>
              <Copy size={14} />
            </button>
          </div>
        );
      })}
      {artifacts.length === 0 && <div className="empty-row">暂无符合筛选条件的制品。</div>}
    </div>
  );
}

function shortHash(value: string | undefined): string {
  return value === undefined ? "--" : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
