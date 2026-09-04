import {
  Check,
  CircleAlert,
  Eye,
  LoaderCircle,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
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
  fetchSessionActions,
  pauseSession,
  preflightSession,
  refreshSession,
  retrySessionAction,
  resumeSession,
  startSession,
  type DeviceRecord,
  type SessionActionView,
  type SessionState,
  type SessionView,
} from "../state/api";

const DEFAULT_PACKAGE = "com.hg.idleweaponshoptycoon.android";

const bridgeModeLabels = {
  REQUIRED: "QA Bridge · 受控校验",
  APPIUM_ONLY: "Appium-only · 非注入同步",
} as const;

const stateLabels: Record<SessionState, string> = {
  CREATED: "已创建",
  PREFLIGHT: "预检中",
  RUNNING: "运行中",
  PAUSED: "已暂停",
  FINISHED: "已完成",
  INTERRUPTED: "已中断",
  FAILED: "失败",
};

const actionStateLabels: Record<SessionActionView["state"], string> = {
  QUEUED: "排队中",
  LEASED: "已租约",
  DISPATCHING: "执行中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  CANCELLED: "已取消",
  UNKNOWN: "未知",
};

type SessionBusyState =
  | "idle"
  | "loading"
  | "creating"
  | "preflight"
  | "starting"
  | "refreshing"
  | "pausing"
  | "resuming";

export function SessionsPage() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [manualSerial, setManualSerial] = useState("");
  const [activeSerial, setActiveSerial] = useState<string | null>(null);
  const [packageName, setPackageName] = useState(DEFAULT_PACKAGE);
  const [failurePolicy, setFailurePolicy] = useState<"PAUSE_ALL" | "QUARANTINE_FAILED_DEVICE">(
    "PAUSE_ALL",
  );
  const [bridgeMode, setBridgeMode] = useState<"REQUIRED" | "APPIUM_ONLY">("REQUIRED");
  const [session, setSession] = useState<SessionView | null>(null);
  const [actions, setActions] = useState<SessionActionView[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [retryingActionId, setRetryingActionId] = useState<string | null>(null);
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
        failurePolicy,
        bridgeMode,
      });
      setSession(created.session);
      setBusy("preflight");
      const preflight = await preflightSession(created.session.id);
      setSession(preflight);
      setBusy("starting");
      const started = await startSession(preflight.id);
      setSession(started);
      setActiveSerial(started.leader.serial);
      await loadSessionActions(started.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会话启动失败");
    } finally {
      setBusy("idle");
    }
  };

  const loadSessionActions = async (id: string) => {
    setActionsLoading(true);
    try {
      setActions(await fetchSessionActions(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "动作记录读取失败");
    } finally {
      setActionsLoading(false);
    }
  };

  const handleRefreshSession = async () => {
    if (session === null) return;
    setError(null);
    setBusy("refreshing");
    try {
      setSession(await refreshSession(session.id));
      await loadSessionActions(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会话状态刷新失败");
    } finally {
      setBusy("idle");
    }
  };

  const handlePauseSession = async () => {
    if (session === null || session.state !== "RUNNING") return;
    setError(null);
    setBusy("pausing");
    try {
      setSession(await pauseSession(session.id));
      await loadSessionActions(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会话暂停失败");
    } finally {
      setBusy("idle");
    }
  };

  const handleResumeSession = async () => {
    if (session === null || session.state !== "PAUSED") return;
    setError(null);
    setBusy("resuming");
    try {
      setSession(await resumeSession(session.id));
      await loadSessionActions(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会话恢复失败");
    } finally {
      setBusy("idle");
    }
  };

  const handleRetryAction = async (action: SessionActionView) => {
    if (
      session === null ||
      session.state !== "RUNNING" ||
      (action.state !== "FAILED" && action.state !== "UNKNOWN")
    )
      return;
    setError(null);
    setRetryingActionId(action.id);
    try {
      await retrySessionAction(session.id, action.id, {
        clientRequestId: createRequestId("retry"),
        sourceMetricsEpoch: action.sourceMetricsEpoch,
        ...(action.sourceFrameId === undefined ? {} : { sourceFrameId: action.sourceFrameId }),
      });
      await loadSessionActions(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "动作重试失败");
    } finally {
      setRetryingActionId(null);
    }
  };

  const previewSerial = manualSerial.trim() || selectedSerials[0] || "";
  const isBusy = busy !== "idle" || actionsLoading || retryingActionId !== null;

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
        {session && <span className="chip chip-good">{bridgeModeLabels[session.bridgeMode]}</span>}
        <button
          className="button button-primary"
          disabled={isBusy || selectedSerials.length === 0 || session !== null}
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
        {session && (
          <div className="session-control-actions" aria-label="会话控制">
            <button
              className="icon-button"
              title="刷新会话状态"
              aria-label="刷新会话状态"
              onClick={() => void handleRefreshSession()}
              disabled={isBusy}
            >
              <RefreshCw className={busy === "refreshing" ? "spin" : undefined} size={17} />
            </button>
            {session.state === "RUNNING" && (
              <button
                className="button button-quiet"
                aria-label="暂停会话"
                onClick={() => void handlePauseSession()}
                disabled={isBusy}
              >
                {busy === "pausing" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Pause size={15} />
                )}
                {busy === "pausing" ? "暂停中" : "暂停会话"}
              </button>
            )}
            {session.state === "PAUSED" && (
              <button
                className="button button-primary"
                aria-label="继续运行"
                onClick={() => void handleResumeSession()}
                disabled={isBusy}
              >
                {busy === "resuming" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Play size={15} />
                )}
                {busy === "resuming" ? "恢复中" : "继续运行"}
              </button>
            )}
          </div>
        )}
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
          <div className="session-mode-field">
            <div className="session-mode-heading">
              <span>同步通道</span>
              <small>创建后不可切换</small>
            </div>
            <div className="choice-grid session-mode-grid" role="group" aria-label="同步通道">
              <button
                className={`choice ${bridgeMode === "REQUIRED" ? "active" : ""}`}
                aria-pressed={bridgeMode === "REQUIRED"}
                onClick={() => setBridgeMode("REQUIRED")}
                disabled={isBusy || session !== null}
              >
                <ShieldCheck size={17} />
                <strong>QA Bridge</strong>
                <small>需要游戏包内置 QA Bridge，并校验焦点与 ACK。</small>
              </button>
              <button
                className={`choice ${bridgeMode === "APPIUM_ONLY" ? "active" : ""}`}
                aria-pressed={bridgeMode === "APPIUM_ONLY"}
                onClick={() => setBridgeMode("APPIUM_ONLY")}
                disabled={isBusy || session !== null}
              >
                <MousePointer2 size={17} />
                <strong>Appium-only</strong>
                <small>不注入 QA Bridge，直接同步系统触控操作。</small>
              </button>
            </div>
          </div>
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
          <div className="session-config-summary">
            <span>当前通道</span>
            <strong>
              {session ? bridgeModeLabels[session.bridgeMode] : bridgeModeLabels[bridgeMode]}
            </strong>
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

      {session && (
        <section className="panel session-actions-panel" aria-labelledby="session-actions-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACTION LOG / {actions.length} RECORDED</p>
              <h2 id="session-actions-title">动作记录</h2>
            </div>
            <button
              className="icon-button"
              title="刷新动作记录"
              aria-label="刷新动作记录"
              onClick={() => void loadSessionActions(session.id)}
              disabled={isBusy}
            >
              <RefreshCw className={actionsLoading ? "spin" : undefined} size={17} />
            </button>
          </div>
          {actionsLoading && actions.length === 0 ? (
            <div className="session-actions-empty" role="status">
              <LoaderCircle className="spin" size={16} />
              正在读取动作记录...
            </div>
          ) : actions.length === 0 ? (
            <div className="session-actions-empty">当前会话还没有动作记录。</div>
          ) : (
            <div className="session-action-list">
              {actions.map((action) => {
                const retryable = action.state === "FAILED" || action.state === "UNKNOWN";
                return (
                  <div className="session-action-row" key={action.id}>
                    <span className="session-action-seq">#{action.actionSeq}</span>
                    <div className="session-action-copy">
                      <strong>{action.type}</strong>
                      <small>{action.clientRequestId}</small>
                      {action.parentActionId && (
                        <small className="session-action-parent">
                          父 action: {action.parentActionId}
                        </small>
                      )}
                    </div>
                    <span
                      className={`chip ${action.state === "SUCCEEDED" ? "chip-good" : action.state === "FAILED" || action.state === "UNKNOWN" ? "chip-danger" : "chip-warn"}`}
                    >
                      {actionStateLabels[action.state]}
                    </span>
                    {retryable && (
                      <button
                        className="button button-quiet session-action-retry"
                        aria-label={`重试 action ${action.actionSeq}`}
                        onClick={() => void handleRetryAction(action)}
                        disabled={isBusy || session.state !== "RUNNING"}
                      >
                        {retryingActionId === action.id ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        {retryingActionId === action.id ? "重试中" : "Retry"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
        <div className="choice-grid" role="group" aria-label="故障处理策略">
          <button
            className={`choice ${failurePolicy === "PAUSE_ALL" ? "active" : ""}`}
            aria-pressed={failurePolicy === "PAUSE_ALL"}
            onClick={() => setFailurePolicy("PAUSE_ALL")}
            disabled={isBusy || session !== null}
          >
            <Pause size={17} />
            <strong>全部暂停</strong>
            <small>保持设备组状态一致</small>
          </button>
          <button
            className={`choice ${failurePolicy === "QUARANTINE_FAILED_DEVICE" ? "active" : ""}`}
            aria-pressed={failurePolicy === "QUARANTINE_FAILED_DEVICE"}
            onClick={() => setFailurePolicy("QUARANTINE_FAILED_DEVICE")}
            disabled={isBusy || session !== null}
          >
            <Square size={17} />
            <strong>隔离失败设备</strong>
            <small>其余设备继续执行</small>
          </button>
        </div>
      </div>
    </PageFrame>
  );
}

function createRequestId(prefix = "session"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
