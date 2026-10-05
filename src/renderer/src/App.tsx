import { useEffect } from "react";
import { actions, useApp } from "./store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { WorkflowView } from "./components/WorkflowView";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { AskDialog } from "./components/AskDialog";

/**
 * 应用外壳：左侧会话栏 + 主区（对话视图 / 数模工作流视图）。
 * 对话是默认主界面；完整工作流经侧栏按钮进入，为独立子功能。
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
    <div className="app-shell">
      <Sidebar />
      {app.view === "chat" ? <ChatView /> : <WorkflowView />}

      {app.showSettings && <SettingsModal />}
      {app.showOnboarding && <OnboardingModal />}
      {app.ask && <AskDialog />}
    </div>
  );
}
