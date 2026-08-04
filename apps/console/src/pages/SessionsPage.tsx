import { Pause, Play, Square } from "lucide-react";
import { PageFrame } from "../components/PageFrame";

export function SessionsPage() {
  return (
    <PageFrame title="会话" eyebrow="TEST SESSIONS / 并行执行">
      <div className="session-state">
        <span className="state-figure">0</span>
        <div>
          <h2>没有运行中的会话</h2>
          <p>从总览创建会话后，操作一台设备即可同步驱动同组设备。</p>
        </div>
        <button className="button button-primary">
          <Play size={15} />
          开始会话
        </button>
      </div>
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
