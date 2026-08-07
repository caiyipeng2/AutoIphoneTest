import { ArrowLeft, RefreshCw, Settings2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { BridgeStatus } from "./BridgeStatus";
import { UidEditorDialog } from "./UidEditorDialog";
import { fetchDeviceBridge, type DeviceRecord, type UidSnapshot } from "../../state/api";

const GAME_PACKAGE = "com.hg.idleweaponshoptycoon.android";

export function DeviceDetails({
  device,
  refreshKey = 0,
  onClose,
}: {
  device: DeviceRecord;
  refreshKey?: number;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<UidSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUid, setEditingUid] = useState(false);
  const load = () => {
    setLoading(true);
    void fetchDeviceBridge(device.serial, GAME_PACKAGE)
      .then((value) => {
        setSnapshot(value);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "桥接状态读取失败"),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, [device.serial, refreshKey]);
  const uid = snapshot?.uid?.uid ?? snapshot?.installation.currentUid ?? "未识别";
  return (
    <section className="device-details" aria-labelledby="device-details-title">
      <div className="device-details-heading">
        <div className="device-details-title">
          <button
            className="icon-button"
            title="返回设备列表"
            aria-label="返回设备列表"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="eyebrow">DEVICE DETAIL / CURRENT GENERATION</p>
            <h2 id="device-details-title">
              {typeof device.metadata.model === "string" ? device.metadata.model : device.serial}
            </h2>
            <span className="mono">{device.serial}</span>
          </div>
        </div>
        <div className="device-details-actions">
          <button
            className="icon-button"
            title="刷新桥接状态"
            aria-label="刷新桥接状态"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={17} />
          </button>
          <button
            className="icon-button"
            title="编辑 UID"
            aria-label="编辑 UID"
            onClick={() => setEditingUid(true)}
            disabled={!snapshot}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {snapshot && (
        <>
          <div className="device-details-grid">
            <div className="detail-block detail-block-uid">
              <span className="detail-label">
                <Smartphone size={14} aria-hidden="true" />
                当前 UID
              </span>
              <strong>{uid}</strong>
              <small>
                {snapshot.uid
                  ? `${snapshot.uid.source} · ${snapshot.uid.observedAt}`
                  : "当前代际尚未观察到 UID"}
              </small>
            </div>
            <BridgeStatus bridge={snapshot.bridge} />
          </div>
          <div className="device-facts">
            <div>
              <span>安装代际</span>
              <strong>{snapshot.installation.installGeneration}</strong>
            </div>
            <div>
              <span>数据代际</span>
              <strong>{snapshot.installation.appDataGeneration}</strong>
            </div>
            <div>
              <span>Bridge boot</span>
              <strong className="mono">{snapshot.bridge.bootId ?? "--"}</strong>
            </div>
            <div>
              <span>构建版本</span>
              <strong className="mono">
                {snapshot.uid?.buildId ?? snapshot.bridge.buildId ?? "--"}
              </strong>
            </div>
          </div>
        </>
      )}
      {loading && <div className="device-details-loading">正在读取当前代际和桥接状态…</div>}
      {editingUid && snapshot && (
        <UidEditorDialog
          serial={device.serial}
          packageName={GAME_PACKAGE}
          current={uid === "未识别" ? "" : uid}
          onClose={() => setEditingUid(false)}
          onSaved={setSnapshot}
        />
      )}
    </section>
  );
}

export { GAME_PACKAGE };
