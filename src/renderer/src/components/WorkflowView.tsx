import { actions, useApp } from "../store";
import { ProjectsMenu } from "./ProjectsMenu";
import { PipelineStrip } from "./PipelineStrip";
import { StreamView } from "./StreamView";
import { PreviewPane } from "./PreviewPane";

/**
 * 数模工作流视图（独立子功能，经侧栏按钮进入）：
 * 项目选择 + 一键全流程 / 单步执行 + 执行流 + 产物预览。
 */
export function WorkflowView(): React.ReactNode {
  const app = useApp();
  const running = app.runStatus === "running";

  return (
    <main className="workflow-view">
      <header className="workflow-header">
        <ProjectsMenu />
        <div className="header-actions">
          <span className={`env-chip ${app.env?.python.found ? "ok" : "bad"}`} title={app.env?.python.path ?? "未检测到 Python"}>
            Python {app.env?.python.found ? "✓" : "✗"}
          </span>
          <span className={`env-chip ${app.env?.xelatex.found ? "ok" : "warn"}`} title={app.env?.xelatex.path ?? "未检测到 XeLaTeX"}>
            XeLaTeX {app.env?.xelatex.found ? "✓" : "⚠"}
          </span>
          {running ? (
            <button className="btn danger" onClick={() => void window.api.abortRun()}>停止执行</button>
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

      <PipelineStrip />
      <div className="main-split">
        <StreamView />
        <PreviewPane />
      </div>
    </main>
  );
}
