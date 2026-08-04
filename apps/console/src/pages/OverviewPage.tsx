import { ArrowUpRight, Play, RefreshCw, ShieldCheck } from "lucide-react";

import type { HealthSnapshot } from "../state/api";
import { DataRow, Metric, PageFrame } from "../components/PageFrame";

export function OverviewPage({
  health,
  onRefresh,
}: {
  health: HealthSnapshot | null;
  onRefresh: () => void;
}) {
  const service = health?.service?.state ?? "STARTING";
  return (
    <PageFrame
      title="总览"
      eyebrow="TEST BAY / 即时态势"
      action={
        <button className="button button-primary">
          <Play size={15} />
          新建测试会话
        </button>
      }
    >
      <div className="run-rail">
        <div>
          <span className="rail-mark">01</span>
          <strong>准备下一轮设备测试</strong>
          <p>确认设备池、构建包和暂停策略后开始。</p>
        </div>
        <button className="button button-quiet" onClick={onRefresh}>
          <RefreshCw size={15} />
          刷新状态
        </button>
      </div>
      <div className="metric-grid">
        <Metric label="在线设备" value="1 / 4" hint="可动态接入 1-4 台" tone="lime" />
        <Metric label="运行会话" value="0" hint="当前无执行中的会话" />
        <Metric label="最近构建" value="—" hint="等待导入 APK / AAB" />
        <Metric
          label="服务状态"
          value={service}
          hint={
            health ? `更新于 ${new Date(health.updatedAt).toLocaleTimeString()}` : "等待服务响应"
          }
          tone={service === "READY" ? "cyan" : "coral"}
        />
      </div>
      <div className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">设备池</p>
              <h2>当前测试席位</h2>
            </div>
            <a className="text-link" href="#devices">
              查看设备 <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="device-line">
            <span className="device-dot online" />
            <div>
              <strong>SM-S9280</strong>
              <small>UID · c6c2d32cda443613</small>
            </div>
            <span className="chip chip-good">可用</span>
          </div>
          <div className="device-line muted">
            <span className="device-dot" />
            <div>
              <strong>还可接入 3 台设备</strong>
              <small>通过 ADB 连接后自动出现在设备池</small>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">系统检查</p>
              <h2>控制面健康</h2>
            </div>
            <ShieldCheck size={19} />
          </div>
          <DataRow
            label="本地服务"
            value={service === "READY" ? "正常" : "需检查"}
            tone={service === "READY" ? "good" : "warn"}
          />
          <DataRow
            label="环境探针"
            value={health?.environment?.overall === "healthy" ? "正常" : "降级"}
            tone={health?.environment?.overall === "healthy" ? "good" : "warn"}
          />
          <DataRow label="实时通道" value="WebSocket" />
        </div>
      </div>
    </PageFrame>
  );
}
