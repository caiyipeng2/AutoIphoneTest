import { MoreHorizontal, RefreshCw, Smartphone } from "lucide-react";
import { PageFrame } from "../components/PageFrame";

export function DevicesPage() {
  return (
    <PageFrame title="设备" eyebrow="DEVICE POOL / 1-4 可变">
      <div className="toolbar">
        <button className="button button-primary">
          <Smartphone size={15} />
          接入设备
        </button>
        <button className="button button-quiet">
          <RefreshCw size={15} />
          重新扫描
        </button>
      </div>
      <div className="table-panel">
        <div className="table-head">
          <span>设备 / UID</span>
          <span>Android</span>
          <span>连接</span>
          <span>状态</span>
          <span />
        </div>
        <div className="table-row">
          <div>
            <strong>SM-S9280</strong>
            <small>UID · c6c2d32cda443613</small>
          </div>
          <span>16</span>
          <span className="mono">R5CX211TXNT</span>
          <span className="chip chip-good">在线</span>
          <button className="icon-button" title="设备操作" aria-label="设备操作">
            <MoreHorizontal size={17} />
          </button>
        </div>
        <div className="empty-row">设备数量按实际 ADB 接入变化，最多展示 4 台并行席位。</div>
      </div>
    </PageFrame>
  );
}
