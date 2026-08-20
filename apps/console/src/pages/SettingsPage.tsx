import { LoaderCircle, RefreshCw, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SettingsSnapshot } from "../state/api";
import { PageFrame } from "../components/PageFrame";
import { CleanupPreviewPanel } from "../features/storage/CleanupPreviewPanel";

export function SettingsPage({
  settings,
  onSave,
}: {
  settings: SettingsSnapshot | null;
  onSave: (patch: { retentionDays: number }) => Promise<SettingsSnapshot>;
}) {
  const [retentionDays, setRetentionDays] = useState(() => readRetentionDays(settings));
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>();
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    if (settings !== null) setRetentionDays(readRetentionDays(settings));
  }, [settings]);

  const save = async () => {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      setSaveError("保留天数必须是 1 到 3650 的整数。");
      setSaveMessage(undefined);
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    setSaveMessage(undefined);
    try {
      await onSave({ retentionDays });
      setSaveMessage("设置已保存");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "设置保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFrame title="设置" eyebrow="CONTROL PLANE / 本地策略">
      <div className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">数据与报告</p>
            <h2>默认工作区</h2>
          </div>
          <Settings2 size={19} />
        </div>
        <div className="form-grid">
          <label>
            数据根目录
            <input defaultValue={String(settings?.values.dataRoot ?? "E:\\TestCenterData")} />
          </label>
          <label>
            报告输出
            <select defaultValue={String(settings?.values.defaultEvidencePolicy ?? "html-zip")}>
              <option value="html-zip">HTML + ZIP</option>
              <option value="html-zip-json">HTML + ZIP + JSON</option>
            </select>
          </label>
          <label htmlFor="settings-retention-days">
            保留天数
            <input
              id="settings-retention-days"
              type="number"
              value={retentionDays}
              onChange={(event) => setRetentionDays(Number(event.target.value))}
              min="1"
              max="3650"
            />
          </label>
          <label>
            服务端口
            <input value="4780" readOnly />
          </label>
        </div>
        <div className="settings-footer">
          <span>配置版本 {settings?.version ?? "—"}</span>
          <div className="settings-actions">
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              disabled={saving}
            >
              <RefreshCw size={15} />
              刷新预览
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
              保存设置
            </button>
          </div>
        </div>
        {saveMessage && (
          <p className="settings-status" role="status">
            {saveMessage}
          </p>
        )}
        {saveError && (
          <p className="inline-error settings-error" role="alert">
            {saveError}
          </p>
        )}
      </div>
      <CleanupPreviewPanel retentionDays={retentionDays} reloadToken={reloadToken} />
    </PageFrame>
  );
}

function readRetentionDays(settings: SettingsSnapshot | null): number {
  const value = settings?.values.retentionDays;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 14;
}
