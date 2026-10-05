import { useState } from "react";
import { actions, useApp } from "../store";

/** 工作流提问对话框：单步模式下 ask_user 工具的应答入口 */
export function AskDialog(): React.ReactNode {
  const app = useApp();
  const [text, setText] = useState("");
  const ask = app.ask;
  if (!ask) return null;

  function answer(value: string): void {
    void window.api.answerAsk(ask!.id, value);
    actions.setState({ ask: null });
  }

  return (
    <div className="modal-mask">
      <div className="modal small">
        <h2>智能体需要你的确认</h2>
        <p className="ask-question">{ask.question}</p>
        {ask.options.length > 0 && (
          <div className="ask-options">
            {ask.options.map((opt) => (
              <button key={opt} className="btn ghost" onClick={() => answer(opt)}>
                {opt}
              </button>
            ))}
          </div>
        )}
        <div className="form-inline">
          <input
            className="input"
            placeholder="或输入自定义回答…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) answer(text.trim());
            }}
          />
          <button className="btn primary" disabled={!text.trim()} onClick={() => answer(text.trim())}>
            回答
          </button>
        </div>
      </div>
    </div>
  );
}
