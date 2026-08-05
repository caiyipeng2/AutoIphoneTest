import { AlertTriangle, CheckCircle2, CircleOff, LoaderCircle } from "lucide-react";

import type { HealthSnapshot } from "../state/api";

export function StatusBanner({
  health,
  connected,
}: {
  health: HealthSnapshot | null;
  connected: boolean;
}) {
  const degraded =
    health?.service?.state === "DEGRADED" ||
    (health?.environment?.overall !== undefined && health.environment.overall !== "healthy");
  const stopping = health?.service?.state === "STOPPING";
  const label = stopping ? "服务停止中" : degraded ? "环境降级" : health ? "服务就绪" : "连接中";
  const Icon = stopping
    ? LoaderCircle
    : degraded
      ? AlertTriangle
      : health
        ? CheckCircle2
        : CircleOff;
  return (
    <div
      className={`health-banner ${degraded ? "is-degraded" : ""}`}
      data-testid="health-banner"
      role="status"
    >
      <Icon size={16} aria-hidden="true" className={stopping ? "spin" : undefined} />
      <span>{label}</span>
      <span className="health-detail">{connected ? "实时状态已连接" : "实时状态未连接"}</span>
    </div>
  );
}
