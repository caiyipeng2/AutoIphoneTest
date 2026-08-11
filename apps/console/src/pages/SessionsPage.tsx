import { Pause, Play, Square } from "lucide-react";
import { useState } from "react";
import { PageFrame } from "../components/PageFrame";
import { VideoViewport } from "../features/sessions/VideoViewport";

export function SessionsPage() {
  const [serialDraft, setSerialDraft] = useState("");
  const [activeSerial, setActiveSerial] = useState<string | null>(null);

  return (
    <PageFrame title="会话" eyebrow="TEST SESSIONS / 并行执行">
      <div className="session-state">
        <span className="state-figure">0</span>
        <div>
          <h2>没有运行中的会话</h2>
          <p>从总览创建会话后，操作一台设备即可同步驱动同组设备。</p>
        </div>
        <button
          className="button button-primary"
          disabled={serialDraft.trim().length === 0}
          onClick={() => setActiveSerial(serialDraft.trim())}
        >
          <Play size={15} />
          连接主视图
        </button>
      </div>
      <div className="panel session-setup">
        <div>
          <p className="eyebrow">LEADER DEVICE / SERIAL</p>
          <h2>选择主设备</h2>
          <p>输入设备串号后连接只读画面，输入操作仍由后续会话动作切片负责。</p>
        </div>
        <label className="session-serial-field">
          <span>Android 设备串号</span>
          <input
            aria-label="Android 设备串号"
            value={serialDraft}
            onChange={(event) => setSerialDraft(event.target.value)}
            placeholder="例如 R5CX211TXNT"
            spellCheck={false}
          />
        </label>
      </div>
      {activeSerial !== null && <VideoViewport serial={activeSerial} />}
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
