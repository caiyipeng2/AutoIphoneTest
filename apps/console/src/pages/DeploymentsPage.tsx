import { Boxes, GitBranch, UploadCloud } from "lucide-react";
import { PageFrame } from "../components/PageFrame";

export function DeploymentsPage() {
  return (
    <PageFrame title="构建" eyebrow="BUILD PIPELINE / 包体分发">
      <div className="metric-grid compact">
        <div className="metric">
          <span>待部署</span>
          <strong>0</strong>
          <small>绑定设备后可分发</small>
        </div>
        <div className="metric">
          <span>成功率</span>
          <strong>—</strong>
          <small>还没有执行记录</small>
        </div>
        <div className="metric">
          <span>目标席位</span>
          <strong>1-4</strong>
          <small>按实际设备数调度</small>
        </div>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">分发任务</p>
            <h2>创建一次构建部署</h2>
          </div>
          <Boxes size={19} />
        </div>
        <div className="form-grid">
          <label>
            选择包体
            <select>
              <option>暂无已登记包体</option>
            </select>
          </label>
          <label>
            目标设备
            <select>
              <option>在线设备（1 台）</option>
            </select>
          </label>
          <label>
            分支 / 版本
            <input placeholder="例如 release/1.0.0" />
          </label>
        </div>
        <button className="button button-primary">
          <UploadCloud size={15} />
          创建部署
        </button>
        <p className="form-note">
          <GitBranch size={14} />
          部署会保留包体校验摘要，不覆盖原始文件。
        </p>
      </div>
    </PageFrame>
  );
}
