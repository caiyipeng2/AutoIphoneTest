import { Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

interface RegisterInstalledDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (deviceSerial: string, packageName: string) => Promise<void>;
}

export function RegisterInstalledDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: RegisterInstalledDialogProps) {
  const [deviceSerial, setDeviceSerial] = useState("");
  const [packageName, setPackageName] = useState("");

  useEffect(() => {
    if (!open) {
      setDeviceSerial("");
      setPackageName("");
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
        aria-labelledby="installed-artifact-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">REGISTER INSTALLED / ONLINE DEVICE</p>
            <h2 id="installed-artifact-title">登记已安装版本</h2>
          </div>
          <button
            className="icon-button"
            title="关闭"
            aria-label="关闭已安装登记窗口"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid compact">
          <label>
            设备 UID / Serial
            <input
              value={deviceSerial}
              onChange={(event) => setDeviceSerial(event.target.value)}
              placeholder="例如 R5CX211TXNT"
            />
          </label>
          <label>
            Android 包名
            <input
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
              placeholder="com.example.game"
            />
          </label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="dialog-actions">
          <span className="toolbar-note">
            <Smartphone size={15} /> 仅允许当前在线设备
          </span>
          <button className="button button-quiet" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="button button-primary"
            disabled={busy || deviceSerial.trim() === "" || packageName.trim() === ""}
            onClick={() => void onSubmit(deviceSerial.trim(), packageName.trim())}
          >
            {busy ? "采集中..." : "开始登记"}
          </button>
        </div>
      </section>
    </div>
  );
}
