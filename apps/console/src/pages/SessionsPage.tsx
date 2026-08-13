import {
  Check,
  CircleAlert,
  Eye,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Smartphone,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "../components/PageFrame";
import { VideoViewport } from "../features/sessions/VideoViewport";
import { IncidentTimeline } from "../features/sessions/IncidentTimeline";
import {
  createSession,
  fetchDevices,
  preflightSession,
  startSession,
  type DeviceRecord,
  type SessionState,
  type SessionView,
} from "../state/api";

const DEFAULT_PACKAGE = "com.hg.idleweaponshoptycoon.android";

const stateLabels: Record<SessionState, string> = {
  CREATED: "已创建",
  PREFLIGHT: "预检中",
  RUNNING: "运行中",
  PAUSED: "已暂停",
  FINISHED: "已完成",
  INTERRUPTED: "已中断",
  FAILED: "失败",
};

type SessionBusyState = "idle" | "loading" | "creating" | "preflight" | "starting";

export function SessionsPage() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [manualSerial, setManualSerial] = useState("");
  const [activeSerial, setActiveSerial] = useState<string | null>(null);
  const [packageName, setPackageName] = useState(DEFAULT_PACKAGE);
  const [session, setSession] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState<SessionBusyState>("loading");
  const [error, setError] = useState<string | null>(null);

  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === "ONLINE"),
    [devices],
  );

  const loadDevices = () => {
    setBusy((value) => (value === "idle" ? "loading" : value));
    void fetchDevices()
      .then((snapshot) => {
        setDevices(Array.isArray(snapshot.devices) ? snapshot.devices : []);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "设备读取失败"),
      )
      .finally(() => setBusy((value) => (value === "loading" ? "idle" : value)));
  };

  useEffect(loadDevices, []);

  const toggleDevice = (serial: string) => {
    setError(null);
    setSelectedSerials((current) => {
      if (current.includes(serial)) return current.filter((item) => item !== serial);
      if (current.length >= 4) {
        setError("一个会话最多选择 4 台设备。");
        return current;
      }
      return [...current, serial];
    });
  };

  const handleCreateSession = async () => {
    const normalizedPackage = packageName.trim();
    if (selectedSerials.length === 0) {
      setError("至少选择 1 台在线设备。");
      return;
    }
    if (normalizedPackage.length === 0) {
      setError("请输入游戏包名。");
      return;
    }
    setError(null);
    setBusy("creating");
    try {
      const created = await createSession({
        clientRequestId: createRequestId(),
        packageName: normalizedPackage,
        deviceSerials: selectedSerials,
        leaderVideoEnabled: true,
      });
      setSession(created.session);
      setBusy("preflight");
      const preflight = await preflightSession(created.session.id);
      setSession(preflight);
      setBusy("starting");
      const started = await startSession(preflight.id);
      setSession(started);
      setActiveSerial(started.leader.serial);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会话启动失败");
    } finally {
      setBusy("idle");
    }
  };

  const previewSerial = manualSerial.trim() || selectedSerials[0] || "";
  const isBusy = busy !== "idle";

  return (
    <PageFrame title="会话" eyebrow="TEST SESSIONS / 1-4 同步执行">
      <div className="session-state">
        <span className="state-figure">{session?.devices.length ?? selectedSerials.length}</span>
        <div>
          <h2>{session ? `会话 ${stateLabels[session.state]}` : "准备一轮同步测试"}</h2>
          <p>
            {session
              ? `${session.devices.length} 台设备已绑定，操作 leader 会并行驱动同组设备。`
              : "选择当前在线设备，平台会按同一动作序列同步执行。"}
          </p>
        </div>
        <button
          className="button button-primary"
          disabled={isBusy || selectedSerials.length === 0 || session?.state === "RUNNING"}
          onClick={() => void handleCreateSession()}
        >
          {isBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
          {busy === "creating"
            ? "创建中"
            : busy === "preflight"
              ? "设备预检"
              : busy === "starting"
                ? "启动中"
                : "创建同步会话"}
        </button>
      </div>

      {error && (
        <div className="inline-error session-error" role="alert">
          <CircleAlert size={15} />
          {error}
        </div>
      )}

      <div className="session-builder">
        <section className="panel session-device-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DEVICE GROUP / {selectedSerials.length} OF 4</p>
              <h2>选择同步设备</h2>
            </div>
            <button
              className="icon-button"
              title="刷新设备"
              aria-label="刷新设备"
              onClick={loadDevices}
              disabled={isBusy}
            >
              <RefreshCw className={busy === "loading" ? "spin" : undefined} size={17} />
            </button>
          </div>
          <div className="device-selection-grid">
            {onlineDevices.map((device) => {
              const selected = selectedSerials.includes(device.serial);
              return (
                <button
                  className={`device-choice ${selected ? "is-selected" : ""}`}
                  key={device.serial}
                  aria-pressed={selected}
                  onClick={() => toggleDevice(device.serial)}
                  disabled={isBusy}
                >
                  <span className="device-choice-icon">
                    {selected ? <Check size={16} /> : <Smartphone size={17} />}
                  </span>
                  <span className="device-choice-copy">
                    <strong>
                      {selectedSerials[0] === device.serial ? "LEADER · " : ""}
                      {device.serial}
                    </strong>
                    <small>
                      {typeof device.metadata.model === "string"
                        ? device.metadata.model
                        : "Android 设备"}
                      {selected ? " · 已加入" : " · 可加入"}
                    </small>
                  </span>
                  <span className={`device-dot ${device.state === "ONLINE" ? "online" : ""}`} />
                </button>
              );
            })}
            {onlineDevices.length === 0 && (
              <div className="device-selection-empty">
                <Smartphone size={18} />
                <span>没有在线设备，请先连接 ADB 真机。</span>
              </div>
            )}
          </div>
          <p className="form-note">
            <Check size={14} /> 首台选中设备作为 leader，其余设备作为 follower 同步执行。
          </p>
        </section>

        <section className="panel session-config-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">RUN CONFIGURATION</p>
              <h2>测试参数</h2>
            </div>
          </div>
          <label className="session-config-field">
            <span>Unity 游戏包名</span>
            <input
              aria-label="Unity 游戏包名"
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="session-config-summary">
            <span>目标设备</span>
            <strong>
              {selectedSerials.length ? `${selectedSerials.length} 台在线设备` : "未选择"}
            </strong>
          </div>
          <div className="session-config-summary">
            <span>账号策略</span>
            <strong>设备 UID 自动绑定</strong>
          </div>
        </section>
      </div>

      {session && (
        <section className="panel session-members-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SESSION MEMBERS / {session.id}</p>
              <h2>设备组状态</h2>
            </div>
            <span className={`chip ${session.state === "RUNNING" ? "chip-good" : "chip-warn"}`}>
              {stateLabels[session.state]}
            </span>
          </div>
          <div className="session-members-grid">
            {session.devices.map((device) => (
              <div className="session-member" key={device.serial}>
                <span
                  className={`device-dot ${device.membershipState === "ACTIVE" ? "online" : ""}`}
                />
                <div>
                  <strong>{device.role === "LEADER" ? "Leader" : "Follower"}</strong>
                  <small>{device.serial}</small>
                </div>
                <span className="chip chip-good">{device.membershipState}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel session-preview-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LEADER PREVIEW / READ ONLY</p>
            <h2>预览主设备</h2>
          </div>
          <Eye size={17} />
        </div>
        <div className="session-preview-controls">
          <label className="session-serial-field">
            <span>Android 设备串号</span>
            <input
              aria-label="Android 设备串号"
              value={manualSerial}
              onChange={(event) => setManualSerial(event.target.value)}
              placeholder="例如 R5CX211TXNT"
              spellCheck={false}
            />
          </label>
          <button
            className="button button-quiet"
            disabled={previewSerial.length === 0}
            onClick={() => setActiveSerial(previewSerial)}
          >
            <Eye size={15} />
            连接主视图
          </button>
        </div>
      </section>

      {activeSerial !== null && <VideoViewport serial={activeSerial} />}

      {session && <IncidentTimeline sessionId={session.id} />}

      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">暂停策略</p>
            <h2>故障时如何处理</h2>
          </div>
        </div>
        <div className="choice-grid">
          <button className="choice active">
            <Pause size={17} />
            <strong>全部暂停</strong>
            <small>保持设备组状态一致</small>
          </button>
          <button className="choice">
            <Square size={17} />
            <strong>隔离失败设备</strong>
            <small>其余设备继续执行</small>
          </button>
        </div>
      </div>
    </PageFrame>
  );
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
