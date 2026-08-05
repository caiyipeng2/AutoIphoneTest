import { Save, Settings2 } from "lucide-react";
import type { SettingsSnapshot } from "../state/api";
import { PageFrame } from "../components/PageFrame";

export function SettingsPage({
  settings,
  onSave,
}: {
  settings: SettingsSnapshot | null;
  onSave: () => void;
}) {
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
          <label>
            保留天数
            <input
              type="number"
              defaultValue={Number(settings?.values.retentionDays ?? 14)}
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
          <button className="button button-primary" onClick={onSave}>
            <Save size={15} />
            保存设置
          </button>
        </div>
      </div>
    </PageFrame>
  );
}
