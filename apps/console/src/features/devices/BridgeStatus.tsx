import { Activity, CircleAlert, CircleCheck, CircleOff } from "lucide-react";
import type { UidSnapshot } from "../../state/api";

const labels = {
  READY: "桥接就绪",
  DEGRADED: "桥接降级",
  UNAVAILABLE: "桥接不可用",
} as const;

export function BridgeStatus({ bridge }: { bridge: UidSnapshot["bridge"] }) {
  const Icon =
    bridge.status === "READY"
      ? CircleCheck
      : bridge.status === "DEGRADED"
        ? CircleAlert
        : CircleOff;
  return (
    <div className={`bridge-status bridge-status-${bridge.status.toLowerCase()}`}>
      <div className="bridge-status-title">
        <Icon size={17} aria-hidden="true" />
        <strong>{labels[bridge.status]}</strong>
        <span className="chip">{bridge.status}</span>
      </div>
      {bridge.reason && <p>{bridge.reason}</p>}
      <div className="bridge-status-meta">
        <span>
          <Activity size={13} aria-hidden="true" />
          {bridge.stateSeq === undefined ? "暂无状态序列" : `状态序列 ${bridge.stateSeq}`}
        </span>
        <span>
          {bridge.lastStateAt ? new Date(bridge.lastStateAt).toLocaleTimeString() : "未上报"}
        </span>
      </div>
      {(bridge.bridgeInstanceId || bridge.buildId) && (
        <div className="bridge-status-identity mono">
          <span>{bridge.bridgeInstanceId ?? "instance--"}</span>
          <span>{bridge.buildId ?? "build--"}</span>
        </div>
      )}
    </div>
  );
}
