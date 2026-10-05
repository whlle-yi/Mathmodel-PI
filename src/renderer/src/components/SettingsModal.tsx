import { useEffect, useState } from "react";
import type { KbSource, ModelInfo, ProviderInfo, SkillInfo } from "@shared/types";
import { actions, useApp } from "../store";

/** 设置：模型接入、知识库、Skills 管理、环境与工作区 */
export function SettingsModal(): React.ReactNode {
  const app = useApp();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [kb, setKb] = useState<KbSource[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>(app.settings?.providers ?? {});
  const [defaultModel, setDefaultModel] = useState(app.settings?.defaultModel ?? "");
  const [thinkingLevel, setThinkingLevel] = useState(app.settings?.thinkingLevel ?? "medium");
  const [saved, setSaved] = useState(false);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbMsg, setKbMsg] = useState("");

  useEffect(() => {
    void window.api.listProviders().then(setProviders);
    void window.api.listSkills().then(setSkills);
    void window.api.kbList().then(setKb);
  }, []);

  useEffect(() => {
    void window.api.listModels().then(setModels);
  }, [keys]);

  async function save(): Promise<void> {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(keys)) if (v.trim()) cleaned[k] = v.trim();
    await window.api.setSettings({
      providers: cleaned,
      defaultModel: defaultModel || undefined,
      thinkingLevel,
    });
    setKeys(cleaned);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function importDir(): Promise<void> {
    const result = await window.api.importSkillsDir();
    if (result) setSkills(await window.api.listSkills());
  }

  async function kbImport(): Promise<void> {
    setKbBusy(true);
    setKbMsg("");
    try {
      const path = await window.api.kbSelectPath();
      if (path) {
        const { source, files } = await window.api.kbImportPath(path);
        setKb(await window.api.kbList());
        setKbMsg(`已导入「${source.name}」：${files} 个文件，${source.chunks} 个片段`);
      }
    } catch (err) {
      setKbMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKbBusy(false);
    }
  }

  return (
    <div className="modal-mask" onClick={() => actions.setState({ showSettings: false })}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>

        <section className="settings-section">
          <h3>模型接入</h3>
          <p className="muted tiny">
            API Key 仅保存在本机用户数据目录，随应用进程注入智能体运行时，不会上传。
            支持为多个服务商分别配置；赛题视觉核验建议使用支持图像输入的服务商。
          </p>
          <div className="provider-table">
            {providers.map((p) => (
              <div key={p.id} className="provider-row">
                <span className="provider-label" title={p.id}>
                  {p.label}
                  {!p.vision && <em className="novision">（暂不支持视觉）</em>}
                </span>
                <input
                  className="input"
                  type="password"
                  placeholder="API Key"
                  value={keys[p.id] ?? ""}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="form-grid two-col">
            <label>默认模型</label>
            <select className="input" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
              <option value="">（自动）</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.provider} / {m.name}
                </option>
              ))}
            </select>
            <label>思考力度</label>
            <select
              className="input"
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value as typeof thinkingLevel)}
            >
              {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings-section">
          <h3>知识库</h3>
          <p className="muted tiny">
            导入往届论文、教材、笔记等资料（PDF/DOCX/MD/TXT），智能体对话与工作流都会自动检索引用。
            全部索引仅保存在本机。
          </p>
          <div className="skills-list">
            {kb.length === 0 && <div className="muted tiny pad">尚未导入资料</div>}
            {kb.map((s) => (
              <div key={s.id} className="skill-row" title={s.path}>
                <b>{s.name}</b>
                <span className="muted">{s.chunks} 个片段</span>
                <button
                  className="btn tiny ghost"
                  onClick={() => {
                    void window.api.kbDeleteSource(s.id).then(() => window.api.kbList().then(setKb));
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <div className="form-inline">
            <button className="btn ghost" disabled={kbBusy} onClick={() => void kbImport()}>
              {kbBusy ? "索引中…" : "导入资料"}
            </button>
            {kbMsg && <span className="muted tiny">{kbMsg}</span>}
          </div>
        </section>

        <section className="settings-section">
          <h3>建模 Skills</h3>
          <p className="muted tiny">应用内置了最新版工作流 skills；你也可以导入其他 skills 目录（导入的同名 skill 不会覆盖内置项）。</p>
          <div className="skills-list">
            {skills.map((s) => (
              <div key={s.name} className="skill-row" title={s.dir}>
                <b>{s.name}</b>
                <span className="muted">{s.description}</span>
                <em className={s.imported ? "tag imported" : "tag builtin"}>{s.imported ? "导入" : "内置"}</em>
              </div>
            ))}
          </div>
          <button className="btn ghost" onClick={() => void importDir()}>
            导入 skills 目录
          </button>
        </section>

        <section className="settings-section">
          <h3>本地环境</h3>
          <div className="env-report">
            <div>
              Python：{app.env?.python.found ? `✓ ${app.env.python.path}` : "✗ 未检测到"}
              {app.env?.python.found && !app.env.python.bundled && "（来自系统，建议保持已安装 numpy/pandas 等库）"}
              {app.env?.python.found && app.env.python.bundled && "（应用内置便携版）"}
            </div>
            <div>
              XeLaTeX：{app.env?.xelatex.found ? `✓ ${app.env.xelatex.path}` : "✗ 未检测到 —— 论文编译前请安装 MiKTeX 或 TeX Live"}
            </div>
            <div>pdftocairo：{app.env?.pdftocairo.found ? "✓" : "⚠ 未检测到（TikZ/SVG 渲染需要，可随 poppler 安装）"}</div>
          </div>
          <button className="btn ghost" onClick={() => void actions.refreshEnv()}>
            重新检测
          </button>
        </section>

        <div className="modal-actions">
          <span className="muted tiny">{saved ? "已保存 ✓" : ""}</span>
          <button className="btn ghost" onClick={() => actions.setState({ showSettings: false })}>
            关闭
          </button>
          <button className="btn primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
