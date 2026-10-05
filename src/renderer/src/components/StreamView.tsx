import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";

/** 执行流视图：agent 文本、工具调用、运行分隔事件的时间线 */
export function StreamView(): React.ReactNode {
  const app = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [app.stream.length]);

  if (!app.projectPath) {
    return (
      <section className="stream empty">
        <div className="empty-hint">
          <h2>从一次建模开始</h2>
          <p>在左侧选择或新建一个项目，然后点击「一键运行全流程」。</p>
          <p className="muted">
            全流程将依次执行：赛题分析 → 建模求解 → 编程实现 → 论文策划 → 数据图 / 非数据图 → 论文终稿（两轮）→ 验收。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="stream">
      {app.stream.length === 0 && (
        <div className="empty-hint">
          <p className="muted">尚无执行记录。点击「一键运行全流程」或某个阶段的 ▶ 按钮开始。</p>
        </div>
      )}
      {app.stream.map((item) => {
        if (item.kind === "run") {
          const label =
            item.runStatus === "running"
              ? item.runMode === "auto"
                ? "▶ 全流程开始"
                : "▶ 阶段任务开始"
              : item.runStatus === "finished"
                ? "✔ 执行完成"
                : item.runStatus === "aborted"
                  ? "■ 已中止"
                  : `✘ 执行失败${item.error ? `：${item.error}` : ""}`;
          return (
            <div key={item.id} className={`run-divider ${item.runStatus}`}>
              <span>{label}</span>
            </div>
          );
        }
        if (item.kind === "tool") {
          const open = !collapsed[item.id];
          return (
            <div key={item.id} className={`tool-row ${item.toolStatus} ${item.ok === false ? "error" : ""}`}>
              <button
                className="tool-toggle"
                onClick={() => setCollapsed((c) => ({ ...c, [item.id]: open }))}
              >
                {open ? "▾" : "▸"} {item.toolStatus === "start" ? "⚙" : item.ok === false ? "✘" : "✔"}{" "}
                {item.toolName}
                <span className="tool-args">{item.argsPreview}</span>
              </button>
              {open && item.resultPreview && <pre className="tool-result">{item.resultPreview}</pre>}
            </div>
          );
        }
        return (
          <div key={item.id} className={`assistant-bubble ${item.streaming ? "streaming" : ""}`}>
            {item.text}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </section>
  );
}
