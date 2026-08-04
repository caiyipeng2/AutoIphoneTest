import { FileUp, PackageOpen } from "lucide-react";
import { PageFrame } from "../components/PageFrame";

export function AppsPage() {
  return (
    <PageFrame title="应用" eyebrow="APP CATALOG / 包体登记">
      <div className="upload-panel">
        <PackageOpen size={30} />
        <div>
          <h2>导入 Unity Android 包体</h2>
          <p>支持 APK 与 AAB。登记后可绑定构建配置和测试会话。</p>
        </div>
        <button className="button button-primary">
          <FileUp size={15} />
          选择包体
        </button>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">已登记包体</p>
            <h2>最近使用</h2>
          </div>
        </div>
        <div className="empty-state">暂无包体。导入第一个 APK 后，它会显示在这里。</div>
      </div>
    </PageFrame>
  );
}
