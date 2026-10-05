import { useEffect } from "react";
import { actions, useApp } from "./store";
import { Header } from "./components/Header";
import { PipelineStrip } from "./components/PipelineStrip";
import { StreamView } from "./components/StreamView";
import { PreviewPane } from "./components/PreviewPane";
import { NewRunModal } from "./components/NewRunModal";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { AskDialog } from "./components/AskDialog";

/**
 * 工作台主布局：顶栏（项目与运行控制）→ 流水线阶段条 →
 * 执行流（左）+ 产物预览（右），模态层承载运行表单 / 设置 / 引导 / 提问。
 */
export default function App(): React.ReactNode {
  const app = useApp();

  useEffect(() => {
    void actions.init();
  }, []);

  if (!app.ready) {
    return <div className="boot">正在启动 Mathmodel-PI…</div>;
  }

  return (
    <div className="workbench">
      <Header />
      <PipelineStrip />
      <main className="main-split">
        <StreamView />
        <PreviewPane />
      </main>

      {app.showNewRun && <NewRunModal />}
      {app.showSettings && <SettingsModal />}
      {app.showOnboarding && <OnboardingModal />}
      {app.ask && <AskDialog />}
    </div>
  );
}
