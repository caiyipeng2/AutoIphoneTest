import { FileUp, X } from "lucide-react";
import { useEffect, useState } from "react";

interface ImportArtifactDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (file: File, kind: "APK" | "AAB", importSource: string) => Promise<void>;
}

export function ImportArtifactDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: ImportArtifactDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"APK" | "AAB">("APK");
  const [importSource, setImportSource] = useState("");

  useEffect(() => {
    if (!open) {
      setFile(null);
      setImportSource("");
      setKind("APK");
    }
  }, [open]);

  if (!open) return null;
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
        aria-labelledby="import-artifact-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">IMPORT ARTIFACT / IMMUTABLE</p>
            <h2 id="import-artifact-title">导入 Android 包体</h2>
          </div>
          <button className="icon-button" title="关闭" aria-label="关闭导入窗口" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            包体类型
            <select value={kind} onChange={(event) => setKind(event.target.value as "APK" | "AAB")}>
              <option value="APK">APK</option>
              <option value="AAB">AAB</option>
            </select>
          </label>
          <label>
            导入源目录（可选）
            <input
              value={importSource}
              onChange={(event) => setImportSource(event.target.value)}
              placeholder="默认使用服务器导入目录"
            />
          </label>
          <label className="file-picker">
            文件
            <input
              type="file"
              accept=".apk,.aab,application/vnd.android.package-archive"
              aria-label="选择 APK 或 AAB 文件"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected?.name.toLowerCase().endsWith(".aab")) setKind("AAB");
                if (selected?.name.toLowerCase().endsWith(".apk")) setKind("APK");
              }}
            />
            <span className="file-picker-value">{file?.name ?? "选择 APK 或 AAB 文件"}</span>
          </label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="button button-primary"
            disabled={busy || file === null}
            onClick={() => file !== null && void onSubmit(file, kind, importSource)}
          >
            <FileUp size={15} /> {busy ? "导入中..." : "开始导入"}
          </button>
        </div>
      </section>
    </div>
  );
}
