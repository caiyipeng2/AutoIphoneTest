import { LoaderCircle, Save, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { issueUidConfirmation, updateManualUid, type UidSnapshot } from "../../state/api";

export function UidEditorDialog({
  serial,
  packageName,
  current,
  onClose,
  onSaved,
}: {
  serial: string;
  packageName: string;
  current: string;
  onClose: () => void;
  onSaved: (snapshot: UidSnapshot) => void;
}) {
  const [uid, setUid] = useState(current);
  const [nonce, setNonce] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestConfirmation = () => {
    setBusy(true);
    void issueUidConfirmation(serial, packageName)
      .then(setNonce)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "确认失败"))
      .finally(() => setBusy(false));
  };
  const save = () => {
    if (!nonce || uid.trim() === "") return;
    setBusy(true);
    void updateManualUid(serial, packageName, uid.trim(), nonce)
      .then((snapshot) => {
        onSaved(snapshot);
        onClose();
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "UID 保存失败"),
      )
      .finally(() => setBusy(false));
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
        aria-labelledby="uid-dialog-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">MANUAL CORRECTION</p>
            <h2 id="uid-dialog-title">修正设备 UID</h2>
          </div>
          <button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="notice-banner">
          <ShieldCheck size={15} aria-hidden="true" />
          手动 UID 只对当前安装代际生效，并记录操作者和时间。
        </div>
        <label className="uid-field">
          <span>UID</span>
          <input
            value={uid}
            onChange={(event) => setUid(event.target.value)}
            maxLength={256}
            autoFocus
          />
        </label>
        {error && <p className="inline-error">{error}</p>}
        <div className="dialog-actions">
          {!nonce ? (
            <button
              className="button button-primary"
              onClick={requestConfirmation}
              disabled={busy || uid.trim() === ""}
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
              获取一次性确认
            </button>
          ) : (
            <button
              className="button button-primary"
              onClick={save}
              disabled={busy || uid.trim() === ""}
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
              保存当前 UID
            </button>
          )}
          <button className="button button-quiet" onClick={onClose} disabled={busy}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
