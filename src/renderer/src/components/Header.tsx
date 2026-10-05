import { actions, useApp } from "../store";
import { ProjectsMenu } from "./ProjectsMenu";

/** 顶栏：应用标识、当前项目、运行控制与环境状态徽标 */
export function Header(): React.ReactNode {
  const app = useApp();
  const running = app.runStatus === "running";
  const pythonOk = app.env?.python.found;
  const texOk = app.env?.xelatex.found;

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">π</span>
        <span className="brand-name">Mathmodel-PI</span>
        <span className="brand-sub">数学建模智能体工作台</span>
      </div>

      <ProjectsMenu />

      <div className="header-actions">
        <span className={`env-chip ${pythonOk ? "ok" : "bad"}`} title={app.env?.python.path ?? "未检测到 Python"}>
          Python {pythonOk ? "✓" : "✗"}
        </span>
        <span className={`env-chip ${texOk ? "ok" : "warn"}`} title={app.env?.xelatex.path ?? "未检测到 XeLaTeX"}>
          XeLaTeX {texOk ? "✓" : "⚠"}
        </span>
        <button className="btn ghost" onClick={() => actions.setState({ showSettings: true })}>
          设置
        </button>
        {running ? (
          <button className="btn danger" onClick={() => void window.api.abortRun()}>
            停止执行
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!app.projectPath}
            onClick={() => actions.setState({ showNewRun: true })}
          >
            一键运行全流程
          </button>
        )}
      </div>
    </header>
  );
}
