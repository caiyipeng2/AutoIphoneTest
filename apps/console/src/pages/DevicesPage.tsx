import { MoreHorizontal, RefreshCw, Save, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "../components/PageFrame";
import { fetchDevices, updateDeviceTags, type DeviceRecord, type DeviceState } from "../state/api";

const stateLabels: Record<DeviceState, string> = {
  ONLINE: "在线",
  UNAUTHORIZED: "待授权",
  OFFLINE: "离线",
  UNKNOWN: "未知",
};

export function DevicesPage({ refreshKey = 0 }: { refreshKey?: number }) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [filter, setFilter] = useState<"ALL" | DeviceState>("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [groupDraft, setGroupDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void fetchDevices()
      .then((snapshot) => {
        setDevices(Array.isArray(snapshot.devices) ? snapshot.devices : []);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "设备读取失败"),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  const visible = useMemo(
    () => (filter === "ALL" ? devices : devices.filter((device) => device.state === filter)),
    [devices, filter],
  );
  const beginEdit = (device: DeviceRecord) => {
    setEditing(device.serial);
    setTagDraft(device.tags.map((tag) => tag.label).join(", "));
    setGroupDraft(device.group?.label ?? "");
  };
  const saveTags = (device: DeviceRecord) => {
    void updateDeviceTags(
      device.serial,
      tagDraft
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      groupDraft,
    )
      .then((updated) => {
        setDevices((current) =>
          current.map((item) => (item.serial === updated.serial ? updated : item)),
        );
        setEditing(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "标签保存失败"),
      );
  };

  return (
    <PageFrame title="设备" eyebrow="DEVICE POOL / 1-4 可变">
      <div className="toolbar">
        <span className="toolbar-note">
          <Smartphone size={15} /> 实际接入 {devices.length} 台
        </span>
        <div className="toolbar-spacer" />
        <select
          aria-label="设备状态筛选"
          value={filter}
          onChange={(event) => setFilter(event.target.value as "ALL" | DeviceState)}
        >
          <option value="ALL">全部状态</option>
          <option value="ONLINE">在线</option>
          <option value="UNAUTHORIZED">待授权</option>
          <option value="OFFLINE">离线</option>
          <option value="UNKNOWN">未知</option>
        </select>
        <button className="button button-quiet" onClick={load} disabled={loading}>
          <RefreshCw size={15} /> 重新扫描
        </button>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="table-panel">
        <div className="table-head">
          <span>设备 / UID</span>
          <span>Android</span>
          <span>连接</span>
          <span>状态</span>
          <span>标签</span>
          <span />
        </div>
        {visible.map((device) => {
          const metadata = device.metadata;
          const model = typeof metadata.model === "string" ? metadata.model : "未知型号";
          const android =
            typeof metadata.androidRelease === "string" ? metadata.androidRelease : "--";
          const uid = typeof metadata.uid === "string" ? metadata.uid : device.serial;
          return (
            <div className="table-row" key={device.serial}>
              <div>
                <strong>{model}</strong>
                <small>UID · {uid}</small>
              </div>
              <span>{android}</span>
              <span className="mono">{device.serial}</span>
              <span
                className={`chip ${device.state === "ONLINE" ? "chip-good" : device.state === "OFFLINE" ? "chip-muted" : "chip-warn"}`}
              >
                {stateLabels[device.state]}
              </span>
              <span className="tag-list">
                {device.tags.map((tag) => tag.label).join(" · ") || "未分组"}
              </span>
              <button
                className="icon-button"
                title="编辑设备标签"
                aria-label="编辑设备标签"
                onClick={() => beginEdit(device)}
              >
                <MoreHorizontal size={17} />
              </button>
              {editing === device.serial && (
                <div className="device-edit">
                  <input
                    aria-label="设备标签"
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    placeholder="标签，用逗号分隔"
                  />
                  <input
                    aria-label="设备分组"
                    value={groupDraft}
                    onChange={(event) => setGroupDraft(event.target.value)}
                    placeholder="分组"
                  />
                  <button
                    className="icon-button"
                    title="保存标签"
                    aria-label="保存标签"
                    onClick={() => saveTags(device)}
                  >
                    <Save size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="empty-row">
            {loading ? "正在读取 ADB 设备..." : "暂无符合条件的设备。"}
          </div>
        )}
      </div>
    </PageFrame>
  );
}
