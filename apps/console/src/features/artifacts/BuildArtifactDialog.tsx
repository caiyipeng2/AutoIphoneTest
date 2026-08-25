import { CheckCircle2, Hammer, LoaderCircle, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ArtifactImportResponse, BuildProviderRecord } from "./artifact-api";

interface BuildArtifactDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  providers: BuildProviderRecord[];
  onClose: () => void;
  onSubmit: (input: {
    providerId: string;
    kind: "APK" | "AAB";
    artifactPath: string;
    importSource: string;
    originalName: string;
  }) => Promise<ArtifactImportResponse>;
}

export function BuildArtifactDialog({
  open,
  busy,
  error,
  providers,
  onClose,
  onSubmit,
}: BuildArtifactDialogProps) {
  const defaultProvider = useMemo(
    () => providers.find((provider) => provider.default)?.id ?? providers[0]?.id ?? "",
    [providers],
  );
  const [providerId, setProviderId] = useState(defaultProvider);
  const [kind, setKind] = useState<"APK" | "AAB">("APK");
  const [importSource, setImportSource] = useState("");
  const [artifactPath, setArtifactPath] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [result, setResult] = useState<ArtifactImportResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProviderId(defaultProvider);
      setKind("APK");
      setImportSource("");
      setArtifactPath("");
      setOriginalName("");
      setResult(null);
      setLocalError(null);
    } else if (providerId === "" && defaultProvider !== "") {
      setProviderId(defaultProvider);
    }
  }, [defaultProvider, open, providerId]);

  if (!open) return null;

  const submit = async () => {
    if (providerId === "" || artifactPath.trim() === "") return;
    setLocalError(null);
    setResult(null);
    try {
      const next = await onSubmit({
        providerId,
        kind,
        artifactPath: artifactPath.trim(),
        importSource: importSource.trim(),
        originalName: originalName.trim(),
      });
      setResult(next);
    } catch (reason: unknown) {
      setLocalError(reason instanceof Error ? reason.message : "构建失败");
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="build-artifact-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">BUILD PROVIDER / CONTROLLED PATH</p>
            <h2 id="build-artifact-title">按提供器构建包体</h2>
          </div>
          <button className="icon-button" title="关闭" aria-label="关闭构建窗口" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            构建提供器
            <select
              aria-label="构建提供器"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              disabled={busy || providers.length === 0}
            >
              {providers.length === 0 ? (
                <option value="">暂无可用提供器</option>
              ) : (
                providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {providerLabel(provider.id)}
                    {provider.default ? " · 默认" : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            包体类型
            <select
              aria-label="构建包体类型"
              value={kind}
              onChange={(event) => setKind(event.target.value as "APK" | "AAB")}
              disabled={busy}
            >
              <option value="APK">APK</option>
              <option value="AAB">AAB</option>
            </select>
          </label>
          <label>
            导入源目录（可选）
            <input
              aria-label="构建导入源目录"
              value={importSource}
              onChange={(event) => setImportSource(event.target.value)}
              placeholder="默认使用服务器导入根目录"
              disabled={busy}
            />
          </label>
          <label>
            输出路径（相对导入根目录）
            <input
              aria-label="构建输出路径"
              value={artifactPath}
              onChange={(event) => setArtifactPath(event.target.value)}
              placeholder="Builds/game.apk"
              disabled={busy}
              required
            />
          </label>
          <label>
            原始文件名（可选）
            <input
              aria-label="构建原始文件名"
              value={originalName}
              onChange={(event) => setOriginalName(event.target.value)}
              placeholder="game.apk"
              disabled={busy}
            />
          </label>
        </div>
        <p className="form-note">
          <Hammer size={14} /> 路径只允许位于配置导入根目录内，绝对路径和目录穿越会被拒绝。
        </p>
        {(error || localError) && (
          <div className="inline-error" role="alert">
            {localError ?? error}
          </div>
        )}
        {result && <BuildResult result={result} />}
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button
            className="button button-primary"
            disabled={busy || providerId === "" || artifactPath.trim() === ""}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <Hammer size={15} />}
            {busy ? "构建中..." : "开始构建"}
          </button>
        </div>
      </section>
    </div>
  );
}

function BuildResult({ result }: { result: ArtifactImportResponse }) {
  const events = result.events ?? [];
  return (
    <div className="build-result" role="status">
      <div className="build-result-heading">
        <div>
          <p className="eyebrow">BUILD RESULT / {result.buildId}</p>
          <strong>
            {result.artifact.publishState === "CREATED" ? "包体已发布" : "包体已复用"}
          </strong>
        </div>
        <CheckCircle2 size={20} aria-hidden="true" />
      </div>
      <ol className="build-event-list">
        {events.map((event, index) => (
          <li
            key={`${event.phase}-${index}`}
            className={event.status === "failed" ? "is-failed" : ""}
          >
            {event.status === "failed" ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            <span>{event.phase}</span>
            <small>{event.message ?? event.status}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function providerLabel(id: string): string {
  if (id === "artifact-import") return "现有包体导入";
  if (id === "unity-command") return "Unity 命令构建";
  return id;
}
