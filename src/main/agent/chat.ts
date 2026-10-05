import { app } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ChatSessionMeta } from "@shared/types";
import type { RunOptions } from "@shared/types";
import { WORKFLOW_SKILLS } from "@shared/stages";
import { loadSettings } from "../settings";
import { createMMSession, type AskUserContext } from "./session";

/**
 * 对话服务（主界面）。
 *
 * 每个会话 = 一份持久化的消息记录（userData/chat/<id>.jsonl）
 *           + 执行期间的一个活跃 pi 会话（执行结束即释放，上下文以
 *             末次摘要方式带入下一轮，见 CONTEXT_WINDOW_NOTE）。
 *
 * 发送路由：
 * - 该会话有活跃运行 → followUp() 插队为后续消息；
 * - 空闲 → 新建 pi 会话并 prompt()。
 *
 * 会话历史重建：重启后新建 pi 会话时，把最近的对话记录拼进首条
 * 消息，保证模型拥有上文（受上下文窗口限制，只带最近若干条）。
 */

const CONTEXT_WINDOW_NOTE = "（上下文以最近对话重建，更早内容见知识库与项目文件）";

export type ChatEvent =
  | { type: "user"; sessionId: string; text: string; ts: number }
  | { type: "assistant"; sessionId: string; text: string; ts: number }
  | { type: "info"; sessionId: string; text: string; ts: number }
  | { type: "text"; sessionId: string; delta: string }
  | { type: "tool"; sessionId: string; callId: string; name: string; status: "start" | "done"; argsPreview?: string; resultPreview?: string; ok?: boolean }
  | { type: "busy"; sessionId: string; busy: boolean }
  | { type: "sessions"; sessions: ChatSessionMeta[] };

interface PersistedLine extends ChatMessage {
  kind?: "tool";
  toolName?: string;
  toolStatus?: "start" | "done";
  argsPreview?: string;
  resultPreview?: string;
  ok?: boolean;
}

export class ChatService {
  private active = new Map<string, AgentSession>();
  private askSeq = 0;

  constructor(private readonly emit: (event: ChatEvent) => void) {}

  // ---------------------------------------------------------------- 存储

  private get chatDir(): string {
    const dir = join(app.getPath("userData"), "chat");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private get indexPath(): string {
    return join(this.chatDir, "index.json");
  }

  private loadIndex(): ChatSessionMeta[] {
    try {
      return JSON.parse(readFileSync(this.indexPath, "utf-8")) as ChatSessionMeta[];
    } catch {
      return [];
    }
  }

  private saveIndex(sessions: ChatSessionMeta[]): void {
    writeFileSync(this.indexPath, JSON.stringify(sessions, null, 2), "utf-8");
  }

  private transcriptPath(id: string): string {
    return join(this.chatDir, `${id}.jsonl`);
  }

  private appendTranscript(id: string, line: PersistedLine): void {
    appendFileSync(this.transcriptPath(id), JSON.stringify(line) + "\n", "utf-8");
  }

  private loadTranscript(id: string): PersistedLine[] {
    try {
      return (readFileSync(this.transcriptPath(id), "utf-8") || "")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as PersistedLine);
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------- 会话管理

  listSessions(): ChatSessionMeta[] {
    return this.loadIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createSession(cwd: string): ChatSessionMeta {
    const meta: ChatSessionMeta = {
      id: randomUUID(),
      title: "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd,
      messageCount: 0,
    };
    const sessions = this.loadIndex();
    sessions.push(meta);
    this.saveIndex(sessions);
    this.emit({ type: "sessions", sessions: this.listSessions() });
    return meta;
  }

  /** 会话未开始对话前允许改工作目录（一旦有消息，pi 会话已绑定 cwd，不可改） */
  setCwd(id: string, cwd: string): ChatSessionMeta {
    if (this.active.has(id)) throw new Error("会话执行中，不能更改工作目录");
    const lines = this.loadTranscript(id);
    if (lines.some((l) => l.role === "user" || l.role === "assistant")) {
      throw new Error("会话已开始，不能更改工作目录；请新建对话");
    }
    const sessions = this.loadIndex();
    const meta = sessions.find((s) => s.id === id);
    if (!meta) throw new Error("会话不存在");
    meta.cwd = cwd;
    this.saveIndex(sessions);
    this.emit({ type: "sessions", sessions: this.listSessions() });
    return meta;
  }

  /** 新会话的默认工作目录：上次使用过的（最近会话）→ 用户目录惰性兜底 */
  defaultCwd(): string {
    const last = this.loadIndex().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last?.cwd) return last.cwd;
    return join(app.getPath("documents"), "Mathmodel-PI");
  }

  deleteSession(id: string): void {
    if (this.active.has(id)) throw new Error("会话正在执行中，请先停止");
    rmSync(this.transcriptPath(id), { force: true });
    this.saveIndex(this.loadIndex().filter((s) => s.id !== id));
    this.emit({ type: "sessions", sessions: this.listSessions() });
  }

  getTranscript(id: string): PersistedLine[] {
    return this.loadTranscript(id);
  }

  isBusy(id: string): boolean {
    return this.active.has(id);
  }

  // ---------------------------------------------------------------- 发送

  async send(id: string, text: string): Promise<void> {
    const meta = this.loadIndex().find((s) => s.id === id);
    if (!meta) throw new Error("会话不存在");

    const now = Date.now();
    const isIdle = !this.active.has(id);
    this.appendTranscript(id, { id: now, role: "user", text, ts: now });
    this.emit({ type: "user", sessionId: id, text, ts: now });

    // 活跃运行中 → 插话；空闲 → 新开会话
    if (!isIdle) {
      const session = this.active.get(id)!;
      try {
        await session.followUp(text);
      } catch {
        await session.steer(text);
      }
      return;
    }

    mkdirSync(meta.cwd, { recursive: true });
    const session = await this.buildSession(meta);
    const prompt = this.decoratePrompt(id, text);
    this.emit({ type: "busy", sessionId: id, busy: true });
    try {
      await session.prompt(prompt);
      this.emit({ type: "busy", sessionId: id, busy: false });
    } catch (err) {
      this.emit({ type: "busy", sessionId: id, busy: false });
      const message = err instanceof Error ? err.message : String(err);
      const ts = Date.now();
      this.appendTranscript(id, { id: ts, role: "info", text: `✘ 出错：${message}`, ts });
      this.emit({ type: "info", sessionId: id, text: `✘ 出错：${message}`, ts });
    } finally {
      session.dispose();
      this.active.delete(id);
    }
  }

  async abort(id: string): Promise<void> {
    const session = this.active.get(id);
    if (session) {
      await session.abort();
      this.active.delete(id);
      this.emit({ type: "busy", sessionId: id, busy: false });
    }
  }

  /** 把最近的对话记录拼进首条消息，重建上下文 */
  private decoratePrompt(id: string, text: string): string {
    const history = this.loadTranscript(id).filter((l) => l.role !== "info").slice(-12, -1);
    if (history.length === 0) {
      return this.persona() + "\n\n【用户】" + text;
    }
    const replay = history
      .map((l) => `${l.role === "user" ? "【用户】" : "【助手】"}${l.text.slice(0, 2000)}`)
      .join("\n\n");
    return `${this.persona()}\n\n以下是本会话此前的对话记录（${CONTEXT_WINDOW_NOTE}）：\n\n${replay}\n\n【用户】${text}`;
  }

  private persona(): string {
    return [
      "【系统设定】你是 Mathmodel-PI——面向数学建模领域的专家智能体。",
      "- 回答用户关于数学建模的问题时，优先使用 search_knowledge_base 工具检索知识库（内置竞赛规范、模型字典、写作 playbook 等），引用知识来源。",
      "- 你具备完整的工具能力（读写文件、执行命令），可以帮用户做计算、写代码、画图、改文档；文件操作请在当前工作目录内进行。",
      "- 用户若要求执行完整的建模竞赛全流程，请告知点击界面左下角的「数模工作流」按钮进入专用模式；不要在本对话中尝试跑完整流程。",
    ].join("\n");
  }

  // ---------------------------------------------------------------- 会话构建

  private async buildSession(meta: ChatSessionMeta): Promise<AgentSession> {
    const settings = loadSettings();
    const sessionId = meta.id;
    const self = this;

    const askCtx: AskUserContext = {
      auto: true, // 对话场景不走弹窗，工具不会被注册
      defaults: { focus: "精度优先", subproblems: "auto" },
      ask: async (question) => question,
    };

    const handleEvent = (event: AgentSessionEvent): void => {
      const ts = Date.now();
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            self.emit({ type: "text", sessionId, delta: event.assistantMessageEvent.delta });
          }
          break;
        case "message_end": {
          const msg = event.message as { role?: string; content?: Array<{ type?: string; text?: string }> };
          if (msg.role === "assistant") {
            const text = (msg.content ?? [])
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("");
            if (text.trim()) {
              self.appendTranscript(sessionId, { id: ts, role: "assistant", text, ts });
              self.emit({ type: "assistant", sessionId, text, ts });
              self.touchMeta(sessionId, text);
            }
          }
          break;
        }
        case "tool_execution_start":
          self.emit({
            type: "tool", sessionId, callId: event.toolCallId, name: event.toolName,
            status: "start", argsPreview: preview(event.args),
          });
          break;
        case "tool_execution_end": {
          const resultPreview = preview((event.result as { content?: unknown })?.content ?? event.result);
          self.emit({
            type: "tool", sessionId, callId: event.toolCallId, name: event.toolName,
            status: "done", resultPreview, ok: !event.isError,
          });
          self.appendTranscript(sessionId, {
            id: ts, role: "info", text: `⚙ ${event.toolName} ${event.isError ? "失败" : "完成"}`,
            ts, kind: "tool", toolName: event.toolName, toolStatus: "done", resultPreview, ok: !event.isError,
          });
          break;
        }
        default:
          break;
      }
    };

    const session = await createMMSession({
      cwd: meta.cwd,
      askCtx,
      onEvent: handleEvent,
      onLog: (log) => {
        const ts = Date.now();
        self.appendTranscript(sessionId, { id: ts, role: "info", text: log, ts });
        self.emit({ type: "info", sessionId, text: log, ts });
      },
      thinkingLevel: settings.thinkingLevel,
      knowledgeBase: true,
      // 对话会话不装配任何工作流 skills：完整工作流只能从工作流视图进入，
      // 对话靠知识层检索（内置知识 + 用户资料）获得专业能力
      excludeSkills: WORKFLOW_SKILLS,
    });

    this.active.set(sessionId, session);
    return session;
  }

  private touchMeta(id: string, lastText: string): void {
    const sessions = this.loadIndex();
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    meta.updatedAt = Date.now();
    meta.messageCount += 1;
    if (meta.title === "新对话" && lastText) {
      meta.title = lastText.replace(/\s+/g, " ").slice(0, 24) || meta.title;
    }
    this.saveIndex(sessions);
    this.emit({ type: "sessions", sessions: this.listSessions() });
  }
}

function preview(value: unknown, limit = 300): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export type { RunOptions };
