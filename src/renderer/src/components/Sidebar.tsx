import { actions, useApp } from "../store";

/** 左侧栏：品牌、会话列表、底部功能入口（数模工作流 / 设置） */
export function Sidebar(): React.ReactNode {
  const app = useApp();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">π</span>
        <span className="brand-name">Mathmodel-PI</span>
      </div>

      <button className="new-chat-btn" onClick={() => void actions.newChat()}>
        ＋ 新对话
      </button>

      <div className="session-list">
        {app.chatSessions.length === 0 && <div className="session-empty muted">还没有对话</div>}
        {app.chatSessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === app.currentChatId ? "selected" : ""}`}
            onClick={() => void actions.selectChat(s.id)}
            title={s.cwd}
          >
            <span className="session-title">{s.title}</span>
            <button
              className="session-delete"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                void actions.deleteChat(s.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          className={`workflow-entry ${app.view === "workflow" ? "active" : ""}`}
          onClick={() => (app.view === "workflow" ? actions.showChat() : actions.showWorkflow())}
        >
          {app.view === "workflow" ? "← 返回对话" : "🏁 数模工作流"}
        </button>
        <button className="settings-entry" onClick={() => actions.setState({ showSettings: true })}>
          ⚙ 设置
        </button>
      </div>
    </aside>
  );
}
