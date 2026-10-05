import { useEffect, useState } from "react";
import type { ModelInfo } from "@shared/types";
import { actions, useApp } from "../store";

/**
 * 一键运行表单：收集编排 skill 开工前所需的全部信息，
 * 运行期间不再打断用户（ask_user 自动应答预设偏好）。
 */
export function NewRunModal(): React.ReactNode {
  const app = useApp();
  const [problemFile, setProblemFile] = useState<string | null>(null);
  const [attachmentsDir, setAttachmentsDir] = useState<string | null>(null);
  const [focus, setFocus] = useState("精度优先");
  const [subproblems, setSubproblems] = useState("auto");
  const [model, setModel] = useState(app.settings?.defaultModel ?? "");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.api.listModels().then((list) => {
      setModels(list);
      if (!model && list.length > 0) setModel(list[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(): Promise<void> {
    if (!app.projectPath || !model) return;
    setSubmitting(true);
    setError("");
    try {
      await window.api.startRun({
        projectPath: app.projectPath,
        mode: "auto",
        problemFile: problemFile ?? undefined,
        attachmentsDir: attachmentsDir ?? undefined,
        focus,
        subproblems,
        model,
        thinkingLevel: app.settings?.thinkingLevel ?? "medium",
      });
      actions.setState({ showNewRun: false });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-mask" onClick={() => actions.setState({ showNewRun: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>一键运行全流程</h2>
        <p className="muted">
          提交后智能体将按 <b>赛题分析 → 建模求解 → 编程实现 → 论文策划 → 图件 → 论文终稿（两轮）→ 验收</b>{" "}
          连续执行，期间不再询问（关键偏好按下方选择自动应答）。
        </p>

        <div className="form-grid">
          <label>题目文件</label>
          <div className="form-inline">
            <button className="btn ghost" onClick={() => void window.api.selectProblemFile().then(setProblemFile)}>
              选择文件
            </button>
            <span className="form-value">{problemFile ?? "未选择（建议选择 PDF）"}</span>
          </div>

          <label>附件目录</label>
          <div className="form-inline">
            <button className="btn ghost" onClick={() => void window.api.selectDirectory().then(setAttachmentsDir)}>
              选择目录
            </button>
            <span className="form-value">{attachmentsDir ?? "无附件"}</span>
          </div>

          <label>侧重点</label>
          <div className="radio-row">
            {["精度优先", "可解释性优先", "速度优先", "均衡"].map((f) => (
              <label key={f} className="radio-item">
                <input type="radio" name="focus" checked={focus === f} onChange={() => setFocus(f)} />
                {f}
              </label>
            ))}
          </div>

          <label>子问题数量</label>
          <div className="form-inline">
            <label className="radio-item">
              <input
                type="radio"
                name="sub"
                checked={subproblems === "auto"}
                onChange={() => setSubproblems("auto")}
              />
              由赛题分析确定
            </label>
            <label className="radio-item">
              <input type="radio" name="sub" checked={subproblems !== "auto"} onChange={() => setSubproblems("3")} />
              已知：
            </label>
            <input
              className="input small"
              type="number"
              min={1}
              max={10}
              disabled={subproblems === "auto"}
              value={subproblems === "auto" ? "" : subproblems}
              onChange={(e) => setSubproblems(e.target.value)}
            />个
          </div>

          <label>模型</label>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.length === 0 && <option value="">（未检测到可用模型，请先在设置中配置 API Key）</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.provider} / {m.name}
              </option>
            ))}
          </select>
          <div />
          <p className="muted tiny">
            提示：赛题视觉核验需要具备图像输入能力的模型。未列出预期模型时，请检查对应 provider 的 API Key。
          </p>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={() => actions.setState({ showNewRun: false })}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={submitting || !model || !app.projectPath}
            onClick={() => void submit()}
          >
            {submitting ? "启动中…" : "开始执行"}
          </button>
        </div>
      </div>
    </div>
  );
}
