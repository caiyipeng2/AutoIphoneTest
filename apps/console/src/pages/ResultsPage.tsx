import { Download, FileCheck2, Search } from "lucide-react";
import { PageFrame } from "../components/PageFrame";

export function ResultsPage() {
  return (
    <PageFrame title="报告" eyebrow="RESULTS / 证据输出">
      <div className="toolbar">
        <label className="search">
          <Search size={15} />
          <input placeholder="搜索会话或 UID" />
        </label>
        <button className="button button-quiet">
          <Download size={15} />
          导出报告
        </button>
      </div>
      <div className="panel">
        <div className="empty-state">
          <FileCheck2 size={32} />
          <h2>报告列表为空</h2>
          <p>默认输出 HTML + ZIP，可在设置中选择附加 JSON。</p>
        </div>
      </div>
    </PageFrame>
  );
}
