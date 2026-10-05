import { useSyncExternalStore } from "react";
import type { Api, ChatEvent, ChatLine, RunSnapshot } from "@shared/api";
import type {
  AppSettings,
  ChatSessionMeta,
  EnvReport,
  FileTreeNode,
  PipelineEvent,
  RunMode,
  StageInfo,
} from "@shared/types";

/**
 * 渲染进程全局状态。
 * 应用有两个视图：chat（对话主界面）与 workflow（数模工作流）。
 * 对话事件与流水线事件分别写入各自的流，经 useApp() 订阅。
 */

declare global {
  interface Window {
    api: Api;
  }
}

export interface StreamItem {
  id: number;
  kind: "user" | "assistant" | "tool" | "run" | "info";
  text?: string;
  streaming?: boolean;
  toolName?: string;
  /** 工具调用实例 id，用于 start/end 事件配对 */
  toolCallId?: string;
  toolStatus?: "start" | "done";
  argsPreview?: string;
  resultPreview?: string;
  ok?: boolean;
  runStatus?: "running" | "finished" | "failed" | "aborted";
  runMode?: RunMode;
  error?: string;
}

export interface AskDialog {
  id: string;
  question: string;
  options: string[];
}

export type View = "chat" | "workflow";

export interface AppState {
  ready: boolean;
  settings: AppSettings | null;
  env: EnvReport | null;
  view: View;

  // 对话（主界面）
  chatSessions: ChatSessionMeta[];
  currentChatId: string | null;
  chatItems: StreamItem[];
  chatBusy: boolean;

  // 工作流视图
  projectPath: string | null;
  projectName: string;
  tree: FileTreeNode | null;
  selectedFile: string | null;
  runStatus: RunSnapshot["status"];
  runMode: RunMode | null;
  stages: StageInfo[];
  stream: StreamItem[];

  ask: AskDialog | null;
  showNewRun: boolean;
  showSettings: boolean;
  showOnboarding: boolean;
}

type Listener = () => void;

let nextId = 1;

let state: AppState = {
  ready: false,
  settings: null,
  env: null,
  view: "chat",

  chatSessions: [],
  currentChatId: null,
  chatItems: [],
  chatBusy: false,

  projectPath: null,
  projectName: "",
  tree: null,
  selectedFile: null,
  runStatus: "idle",
  runMode: null,
  stages: [],
  stream: [],

  ask: null,
  showNewRun: false,
  showSettings: false,
  showOnboarding: false,
};

const listeners = new Set<Listener>();

/**
 * 替换整个 state 对象（而非原地修改）。
 * useSyncExternalStore 以引用相等判断是否重渲染，原地修改会导致 UI 永不更新。
 */
function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

function appendTo(list: StreamItem[], item: Omit<StreamItem, "id">): StreamItem[] {
  return [...list, { ...item, id: nextId++ }];
}

export const actions = {
  setState,

  async init(): Promise<void> {
    const [settings, env, snapshot, sessions] = await Promise.all([
      window.api.getSettings(),
      window.api.checkEnv(),
      window.api.snapshot(),
      window.api.listChatSessions(),
    ]);
    setState({
      ready: true,
      settings,
      env,
      runStatus: snapshot.status,
      stages: snapshot.stages,
      chatSessions: sessions,
      showOnboarding: !settings.onboardingDone,
    });
    window.api.onPipelineEvent(handlePipelineEvent);
    window.api.onChatEvent(handleChatEvent);
    console.info("[Mathmodel-PI] 初始化完成");
  },

  // ---------------------------------------------------------------- 视图

  showChat(): void {
    setState({ view: "chat" });
  },

  showWorkflow(): void {
    setState({ view: "workflow" });
  },

  // ---------------------------------------------------------------- 对话

  async newChat(): Promise<void> {
    const session = await window.api.createChatSession();
    setState({
      view: "chat",
      chatSessions: await window.api.listChatSessions(),
      currentChatId: session.id,
      chatItems: [],
      chatBusy: false,
    });
  },

  async selectChat(id: string): Promise<void> {
    if (id === state.currentChatId) {
      setState({ view: "chat" });
      return;
    }
    const lines = await window.api.getChatTranscript(id);
    const items: StreamItem[] = [];
    for (const line of lines) {
      if (line.kind === "tool") {
        items.push({
          id: nextId++, kind: "tool", toolName: line.toolName, toolStatus: "done",
          resultPreview: line.resultPreview, ok: line.ok,
        });
      } else {
        items.push({ id: nextId++, kind: line.role === "info" ? "info" : line.role, text: line.text });
      }
    }
    const busy = await window.api.isChatBusy(id);
    setState({ view: "chat", currentChatId: id, chatItems: items, chatBusy: busy });
  },

  async deleteChat(id: string): Promise<void> {
    await window.api.deleteChatSession(id);
    if (state.currentChatId === id) setState({ currentChatId: null, chatItems: [], chatBusy: false });
  },

  async sendChat(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    let chatId = state.currentChatId;
    if (!chatId) {
      const session = await window.api.createChatSession();
      chatId = session.id;
      setState({ currentChatId: chatId, chatSessions: await window.api.listChatSessions(), chatItems: [] });
    }
    await window.api.chatSend(chatId, trimmed);
  },

  abortChat(): void {
    if (state.currentChatId) void window.api.chatAbort(state.currentChatId);
  },

  // ---------------------------------------------------------------- 工作流

  async openProject(projectPath: string): Promise<void> {
    const tree = await window.api.openProject(projectPath);
    setState({
      projectPath,
      projectName: projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath,
      tree,
      selectedFile: null,
      stream: [],
    });
    setState({ settings: await window.api.getSettings() });
  },

  async refreshEnv(): Promise<void> {
    setState({ env: await window.api.checkEnv() });
  },

  setStages(stages: StageInfo[]): void {
    setState({ stages: stages.map((s) => ({ ...s })) });
  },
} as const;

// ---------------------------------------------------------------- 流处理

function patchStream(list: StreamItem[], updater: (list: StreamItem[]) => StreamItem[]): StreamItem[] {
  return updater(list);
}

function handlePipelineEvent(event: PipelineEvent): void {
  setState({
    stream: patchStream(state.stream, (list) => {
      switch (event.type) {
        case "run":
          return appendTo(list, { kind: "run", runStatus: event.status, runMode: event.mode, error: event.error });
        case "text": {
          const last = list[list.length - 1];
          if (last && last.kind === "assistant" && last.streaming) {
            return [...list.slice(0, -1), { ...last, text: (last.text ?? "") + event.delta }];
          }
          return appendTo(list, { kind: "assistant", text: event.delta, streaming: true });
        }
        case "assistant-message": {
          const last = list[list.length - 1];
          if (last && last.kind === "assistant" && last.streaming) {
            return [...list.slice(0, -1), { ...last, streaming: false }];
          }
          return list;
        }
        case "tool": {
          const idx = list.findLastIndex((i) => i.kind === "tool" && i.toolCallId === event.callId);
          const patch: Partial<StreamItem> = {
            kind: "tool", toolName: event.name, toolStatus: event.status,
            argsPreview: event.argsPreview, resultPreview: event.resultPreview, ok: event.ok,
          };
          if (idx >= 0) return list.map((item, i) => (i === idx ? { ...item, ...patch } : item));
          return appendTo(list, { kind: "tool", toolCallId: event.callId, ...patch });
        }
        default:
          return list;
      }
    }),
    ...(event.type === "run" ? { runStatus: event.status, runMode: event.mode ?? state.runMode } : {}),
    ...(event.type === "stages" ? { stages: event.stages } : {}),
  });
}

function handleChatEvent(event: ChatEvent): void {
  if (event.type === "sessions") {
    setState({ chatSessions: event.sessions });
    return;
  }
  if (event.type === "busy") {
    setState({ chatBusy: event.busy });
    return;
  }
  // 只处理当前正在查看的会话
  if (event.sessionId !== state.currentChatId) return;

  setState({
    chatItems: patchStream(state.chatItems, (list) => {
      switch (event.type) {
        case "user":
          return appendTo(list, { kind: "user", text: event.text });
        case "text": {
          const last = list[list.length - 1];
          if (last && last.kind === "assistant" && last.streaming) {
            return [...list.slice(0, -1), { ...last, text: (last.text ?? "") + event.delta }];
          }
          return appendTo(list, { kind: "assistant", text: event.delta, streaming: true });
        }
        case "assistant": {
          // 最终文本替换流式气泡，避免重复
          const last = list[list.length - 1];
          if (last && last.kind === "assistant" && last.streaming) {
            return [...list.slice(0, -1), { ...last, text: event.text, streaming: false }];
          }
          return appendTo(list, { kind: "assistant", text: event.text });
        }
        case "info":
          return appendTo(list, { kind: "info", text: event.text });
        case "tool": {
          const idx = list.findLastIndex((i) => i.kind === "tool" && i.toolCallId === event.callId);
          const patch: Partial<StreamItem> = {
            kind: "tool", toolName: event.name, toolStatus: event.status,
            argsPreview: event.argsPreview, resultPreview: event.resultPreview, ok: event.ok,
          };
          if (idx >= 0) return list.map((item, i) => (i === idx ? { ...item, ...patch } : item));
          return appendTo(list, { kind: "tool", toolCallId: event.callId, ...patch });
        }
        default:
          return list;
      }
    }),
  });
}
