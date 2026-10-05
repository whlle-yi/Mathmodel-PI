import { useEffect, useRef, useState } from "react";
import { actions, useApp } from "../store";
import type { StreamItem } from "../store";

/**
 * 对话主界面：消息流 + 底部常驻输入框。
 * 执行中发送的消息会作为插话进入智能体；空闲时开启新的一轮。
 */

function MessageBubble({ item }: { item: StreamItem }): React.ReactNode {
  if (item.kind === "user") {
    return <div className="msg user"><div className="msg-body">{item.text}</div></div>;
  }
  if (item.kind === "info") {
    return <div className="msg info">{item.text}</div>;
  }
  if (item.kind === "tool") {
    const [open, setOpen] = useState(false);
    return (
      <div className={`msg tool ${item.toolStatus} ${item.ok === false ? "error" : ""}`}>
        <button className="tool-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} {item.toolStatus === "start" ? "⚙" : item.ok === false ? "✘" : "✔"} {item.toolName}
          {item.argsPreview && <span className="tool-args">{item.argsPreview}</span>}
        </button>
        {open && item.resultPreview && <pre className="tool-result">{item.resultPreview}</pre>}
      </div>
    );
  }
  return (
    <div className="msg assistant">
      <div className="msg-avatar">π</div>
      <div className={`msg-body ${item.streaming ? "streaming" : ""}`}>{item.text}</div>
    </div>
  );
}

export function ChatView(): React.ReactNode {
  const app = useApp();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const session = app.chatSessions.find((s) => s.id === app.currentChatId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [app.chatItems.length]);

  function send(): void {
    if (app.chatBusy) return;
    const text = draft;
    setDraft("");
    void actions.sendChat(text);
  }

  return (
    <main className="chat-view">
      <header className="chat-header">
        <span className="chat-title">{session?.title ?? "新对话"}</span>
        <span className="muted tiny">
          {app.env?.python.found ? "Python ✓" : "Python ✗"} · {app.env?.xelatex.found ? "XeLaTeX ✓" : "XeLaTeX ⚠"} ·
          工作区 {session?.cwd ?? app.settings?.workspaceDir}
        </span>
      </header>

      <div className="chat-scroll">
        {app.chatItems.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-mark">π</div>
            <h2>数学建模智能体</h2>
            <p className="muted">直接提问即可。我可以讲解建模方法、核对竞赛规范、帮你写代码、算数据、画图、改文档。</p>
            <div className="welcome-cards">
              <div className="welcome-card">“Logistic 回归和灰色预测怎么选？”</div>
              <div className="welcome-card">“帮我算这组数据的相关系数矩阵”</div>
              <div className="welcome-card">“国赛摘要写作有哪些易错点？”</div>
              <div className="welcome-card">“把这张图改成对数坐标”</div>
            </div>
          </div>
        )}
        {app.chatItems.map((item) => <MessageBubble key={item.id} item={item} />)}
        {app.chatBusy && <div className="typing muted">智能体正在工作…（可继续输入，将作为插话被接收）</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder={app.chatBusy ? "智能体工作中，输入内容将在当前任务后插入…" : "输入消息，回车发送（Shift+Enter 换行）"}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {app.chatBusy ? (
          <button className="btn danger send-btn" onClick={() => actions.abortChat()}>停止</button>
        ) : (
          <button className="btn primary send-btn" disabled={!draft.trim()} onClick={send}>发送</button>
        )}
      </div>
    </main>
  );
}
