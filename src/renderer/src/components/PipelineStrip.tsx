import { useApp } from "../store";

const STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  complete: "已完成",
  failed: "失败",
  n_a: "不适用",
};

/** 流水线阶段条：8 个阶段的状态一览；空闲时支持单步执行某个阶段 */
export function PipelineStrip(): React.ReactNode {
  const app = useApp();
  const idle = app.runStatus !== "running";

  return (
    <nav className="pipeline" aria-label="建模流水线">
      {app.stages.map((stage, i) => (
        <div key={stage.key} className="stage-cell">
          <div className={`stage-chip status-${stage.status}`} title={`${stage.skill} · ${STATUS_LABEL[stage.status]}`}>
            <span className="stage-index">{i + 1}</span>
            <span className="stage-label">{stage.label}</span>
            <span className="stage-status">{STATUS_LABEL[stage.status]}</span>
          </div>
          {i < app.stages.length - 1 && <div className={`stage-arrow ${stage.status === "complete" ? "lit" : ""}`} />}
          {idle && app.projectPath && stage.key !== "paper_plan" && (
            <button
              className="stage-run"
              title={`单独执行「${stage.label}」阶段`}
              onClick={() =>
                void window.api.runStage(
                  app.projectPath!,
                  stage.key,
                  app.settings?.defaultModel ?? "",
                )
              }
            >
              ▶
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}
