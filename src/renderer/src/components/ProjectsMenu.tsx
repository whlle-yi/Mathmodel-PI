import { useState } from "react";
import { actions, useApp } from "../store";

/** 项目选择：最近项目列表 + 新建项目（选择父目录并命名） */
export function ProjectsMenu(): React.ReactNode {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleCreate(): Promise<void> {
    if (!parentDir || !name.trim()) return;
    try {
      const { path } = await window.api.createProject(parentDir, name.trim());
      await actions.openProject(path);
      setOpen(false);
      setCreating(false);
      setName("");
      setError("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  async function handleOpen(): Promise<void> {
    const dir = await window.api.selectDirectory();
    if (!dir) return;
    await actions.openProject(dir);
    setOpen(false);
  }

  return (
    <div className="projects-menu">
      <button className="project-badge" onClick={() => setOpen((o) => !o)}>
        {app.projectPath ? `📁 ${app.projectName}` : "📁 选择项目"} ▾
      </button>
      {open && (
        <div className="projects-pop">
          <div className="pop-row">
            <button
              className="btn ghost"
              onClick={() => {
                setCreating((c) => !c);
                setError("");
              }}
            >
              ＋ 新建项目
            </button>
            <button className="btn ghost" onClick={() => void handleOpen()}>
              打开已有目录
            </button>
          </div>

          {creating && (
            <div className="create-form">
              <input
                className="input"
                placeholder="项目名称（如 2025-A 板凳龙）"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn ghost" onClick={() => void window.api.selectDirectory().then(setParentDir)}>
                {parentDir ? `位置：${parentDir}` : "选择保存位置"}
              </button>
              <button className="btn primary" disabled={!parentDir || !name.trim()} onClick={() => void handleCreate()}>
                创建
              </button>
              {error && <div className="form-error">{error}</div>}
            </div>
          )}

          {(app.settings?.recentProjects ?? []).length > 0 && (
            <>
              <div className="pop-title">最近项目</div>
              {(app.settings?.recentProjects ?? []).map((p) => (
                <div
                  key={p}
                  className={`recent-item ${p === app.projectPath ? "selected" : ""}`}
                  title={p}
                  onClick={() => {
                    void actions.openProject(p);
                    setOpen(false);
                  }}
                >
                  {p}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
