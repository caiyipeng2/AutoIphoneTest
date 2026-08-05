import { FileUp, PackageOpen, Plus, RefreshCw, Search, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageFrame } from "../components/PageFrame";
import {
  fetchArtifacts,
  importArtifact,
  registerInstalledArtifact,
  type ArtifactRecord,
} from "../features/artifacts/artifact-api";
import { ArtifactTable } from "../features/artifacts/ArtifactTable";
import { ImportArtifactDialog } from "../features/artifacts/ImportArtifactDialog";
import { RegisterInstalledDialog } from "../features/artifacts/RegisterInstalledDialog";

export function AppsPage() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [filter, setFilter] = useState<"ALL" | ArtifactRecord["kind"]>("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [installedOpen, setInstalledOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    void fetchArtifacts()
      .then((snapshot) => {
        setArtifacts(Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "制品读取失败"),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return artifacts.filter((artifact) => {
      if (filter !== "ALL" && artifact.kind !== filter) return false;
      if (normalized === "") return true;
      const values =
        artifact.kind === "INSTALLED"
          ? [
              artifact.id,
              artifact.kind,
              artifact.packageName,
              artifact.deviceSerial,
              artifact.versionName,
            ]
          : [
              artifact.id,
              artifact.kind,
              artifact.packageName,
              artifact.originalName,
              artifact.versionName,
            ];
      return values.some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [artifacts, filter, query]);

  const handleImport = async (file: File, kind: "APK" | "AAB", importSource: string) => {
    setBusy(true);
    try {
      const result = await importArtifact(file, kind, importSource);
      setNotice(result.state === "DEDUPLICATED" ? "包体已存在，已返回原制品。" : "包体导入成功。");
      setImportOpen(false);
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "包体导入失败");
    } finally {
      setBusy(false);
    }
  };

  const handleInstalled = async (deviceSerial: string, packageName: string) => {
    setBusy(true);
    try {
      const result = await registerInstalledArtifact(deviceSerial, packageName);
      setNotice(
        result.state === "DEDUPLICATED"
          ? "已安装版本已存在，已返回原记录。"
          : "已安装版本登记成功。",
      );
      setInstalledOpen(false);
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "已安装版本登记失败");
    } finally {
      setBusy(false);
    }
  };

  const copyHash = (hash: string) => {
    const write = navigator.clipboard?.writeText(hash);
    if (write === undefined) {
      setNotice("SHA-256 已就绪，请从详情中复制。");
      return;
    }
    void write.then(() => setNotice("SHA-256 已复制."));
  };

  return (
    <PageFrame title="应用" eyebrow="APP CATALOG / 包体登记">
      <div className="upload-panel">
        <PackageOpen size={30} />
        <div>
          <h2>Unity Android 制品库</h2>
          <p>APK、AAB 与设备已安装版本统一登记，按不可变摘要复用。</p>
        </div>
        <div className="upload-actions">
          <button className="button button-quiet" onClick={() => setInstalledOpen(true)}>
            <Smartphone size={15} /> 登记已安装
          </button>
          <button className="button button-primary" onClick={() => setImportOpen(true)}>
            <FileUp size={15} /> 导入包体
          </button>
        </div>
      </div>
      <div className="toolbar artifact-toolbar">
        <div className="search">
          <Search size={15} />
          <input
            aria-label="搜索制品"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="包名、文件名、UID 或摘要"
          />
        </div>
        <select
          aria-label="制品类型筛选"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="ALL">全部类型</option>
          <option value="APK">APK</option>
          <option value="AAB">AAB</option>
          <option value="INSTALLED">已安装</option>
        </select>
        <span className="toolbar-note">
          <PackageOpen size={15} /> {visible.length} 条记录
        </span>
        <button className="button button-quiet" onClick={load} disabled={loading}>
          <RefreshCw size={15} /> 刷新
        </button>
      </div>
      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="inline-error">{error}</div>}
      <div className="panel artifact-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">IMMUTABLE ARTIFACTS</p>
            <h2>登记记录</h2>
          </div>
          <button
            className="icon-button"
            title="新建导入"
            aria-label="新建导入"
            onClick={() => setImportOpen(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        {loading ? (
          <div className="empty-row">正在读取制品库...</div>
        ) : (
          <ArtifactTable artifacts={visible} onCopyHash={copyHash} />
        )}
      </div>
      <ImportArtifactDialog
        open={importOpen}
        busy={busy}
        error={error}
        onClose={() => setImportOpen(false)}
        onSubmit={handleImport}
      />
      <RegisterInstalledDialog
        open={installedOpen}
        busy={busy}
        error={error}
        onClose={() => setInstalledOpen(false)}
        onSubmit={handleInstalled}
      />
    </PageFrame>
  );
}
