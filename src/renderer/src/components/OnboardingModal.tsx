import { useEffect, useState } from "react";
import type { EnvReport, ModelInfo, ProviderInfo } from "@shared/types";
import { actions, useApp } from "../store";

/** 首次启动引导：环境检测 → 模型接入 → 完成 */
export function OnboardingModal(): React.ReactNode {
  const app = useApp();
  const [step, setStep] = useState(0);
  const [env, setEnv] = useState<EnvReport | null>(app.env);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [picked, setPicked] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>(app.settings?.providers ?? {});

  useEffect(() => {
    void window.api.listProviders().then(setProviders);
    void window.api.checkEnv().then((e) => {
      setEnv(e);
      void actions.refreshEnv();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (Object.keys(keys).length > 0) void window.api.listModels().then(setModels);
  }, [keys]);

  async function finish(): Promise<void> {
    const cleaned: Record<string, string> = { ...(app.settings?.providers ?? {}) };
    for (const [k, v] of Object.entries(keys)) if (v.trim()) cleaned[k] = v.trim();
    await window.api.setSettings({
      providers: cleaned,
      defaultModel: picked || undefined,
      onboardingDone: true,
    });
    const settings = await window.api.getSettings();
    actions.setState({ settings, showOnboarding: false });
  }

  return (
    <div className="modal-mask">
      <div className="modal">
        {step === 0 && (
          <>
            <h2>欢迎使用 Mathmodel-PI</h2>
            <p className="muted">
              这是一款基于开源智能体框架 <b>pi</b> 的数学建模竞赛工作台。内置的建模工作流将替你完成
              赛题分析、建模、编程求解、图件绘制与论文终稿。
            </p>
            <div className="env-report">
              <div>Python 运行时：{env?.python.found ? `✓ ${env.python.bundled ? "应用内置便携版" : "系统环境"}` : "✗ 未检测到（公开版安装包将内置便携 Python）"}</div>
              <div>科学计算库：{env ? Object.entries(env.python.packages).map(([k, v]) => `${k}${v ? "✓" : "✗"}`).join("  ") || "检测中…" : ""}</div>
              <div>
                XeLaTeX（论文编译）：{env?.xelatex.found ? `✓ ${env.xelatex.path}` : "⚠ 未检测到 —— 首次论文编译前需安装 MiKTeX 或 TeX Live"}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setStep(1)}>
                下一步：配置模型
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>配置模型接入</h2>
            <p className="muted tiny">
              选择服务商并填入 API Key（仅保存在本机）。也可以稍后在「设置」中为多家服务商分别配置。
              赛题视觉核验建议选择支持图像输入的服务商。
            </p>
            <div className="form-grid">
              <label>服务商</label>
              <select
                className="input"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
              >
                <option value="">（跳过，稍后配置）</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {!p.vision ? "（暂不支持视觉）" : ""}
                  </option>
                ))}
              </select>
              {picked && (
                <>
                  <label>API Key</label>
                  <input
                    className="input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeys((prev) => ({ ...prev, [picked]: e.target.value }));
                    }}
                    placeholder={`${picked} 的 API Key`}
                  />
                </>
              )}
              {models.length > 0 && (
                <>
                  <label>检测到 {models.length} 个可用模型 ✓</label>
                  <div />
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>
                上一步
              </button>
              <button className="btn primary" onClick={() => void finish()}>
                完成引导
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
