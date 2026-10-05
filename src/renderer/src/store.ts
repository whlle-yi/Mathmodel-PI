import { useSyncExternalStore } from "react";
import type { Api, RunSnapshot } from "@shared/api";
import type {
  AppSettings,
  EnvReport,
  FileTreeNode,
  PipelineEvent,
  RunMode,
  StageInfo,
} from "@shared/types";

/**
 * 渲染进程全局状态。
 * 一个精简的外部 store：流水线事件由 onPipelineEvent 持续写入，
 * 组件经 useApp() 订阅。
 */

declare global {
  interface Window {
    api: Api;
  }
}

export interface StreamItem {
  id: number;
  kind: "assistant" | "tool" | "run";
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

export interface AppState {
  ready: boolean;
  settings: AppSettings | null;
  env: EnvReport | null;
  projectPath: string | null;
  projectName: string;
  tree: FileTreeNode | null;
  /** 预览区当前选中的文件 */
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

const state: AppState = {
  ready: false,
  settings: null,
  env: null,
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

function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
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

export const actions = {
  setState,

  async init(): Promise<void> {
    const [settings, env, snapshot] = await Promise.all([
      window.api.getSettings(),
      window.api.checkEnv(),
      window.api.snapshot(),
    ]);
    setState({
      ready: true,
      settings,
      env,
      runStatus: snapshot.status,
      stages: snapshot.stages,
      showOnboarding: !settings.onboardingDone,
    });
    window.api.onPipelineEvent(handleEvent);
  },

  async openProject(projectPath: string): Promise<void> {
    const tree = await window.api.openProject(projectPath);
    setState({
      projectPath,
      projectName: projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath,
      tree,
      selectedFile: null,
      stream: [],
      stages: state.stages.map((s) => ({ ...s, status: s.status === "running" ? "pending" : s.status })),
    });
    const settings = await window.api.getSettings();
    setState({ settings });
  },

  async refreshEnv(): Promise<void> {
    setState({ env: await window.api.checkEnv() });
  },

  // ---------------------------------------------------------------- 事件流

  appendStream(item: Omit<StreamItem, "id">): void {
    state.stream = [...state.stream, { ...item, id: nextId++ }];
    setState({ stream: state.stream });
  },

  setStages(stages: StageInfo[]): void {
    setState({ stages: stages.map((s) => ({ ...s })) });
  },

  patchLastAssistant(delta: string): void {
    const last = state.stream[state.stream.length - 1];
    if (last && last.kind === "assistant" && last.streaming) {
      const updated = { ...last, text: (last.text ?? "") + delta };
      state.stream = [...state.stream.slice(0, -1), updated];
    } else {
      state.stream = [...state.stream, { id: nextId++, kind: "assistant", text: delta, streaming: true }];
    }
    setState({ stream: state.stream });
  },

  sealLastAssistant(): void {
    const last = state.stream[state.stream.length - 1];
    if (last && last.kind === "assistant" && last.streaming) {
      state.stream = [...state.stream.slice(0, -1), { ...last, streaming: false }];
      setState({ stream: state.stream });
    }
  },

  patchTool(callId: string, patch: Partial<StreamItem>): void {
    const idx = state.stream.findLastIndex((i) => i.kind === "tool" && i.toolCallId === callId);
    if (idx >= 0) {
      state.stream = state.stream.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    } else {
      state.stream = [...state.stream, { id: nextId++, kind: "tool", toolCallId: callId, ...patch }];
    }
    setState({ stream: state.stream });
  },
} as const;

function handleEvent(event: PipelineEvent): void {
  switch (event.type) {
    case "run":
      setState({ runStatus: event.status, runMode: event.mode ?? state.runMode });
      actions.appendStream({
        kind: "run",
        runStatus: event.status,
        runMode: event.mode,
        error: event.error,
      });
      break;
    case "text":
      actions.patchLastAssistant(event.delta);
      break;
    case "assistant-message":
      actions.sealLastAssistant();
      break;
    case "tool":
      actions.patchTool(event.callId, {
        kind: "tool",
        toolName: event.name,
        toolStatus: event.status,
        argsPreview: event.argsPreview,
        resultPreview: event.resultPreview,
        ok: event.ok,
      });
      break;
    case "stages":
      actions.setStages(event.stages);
      break;
    case "ask":
      setState({ ask: { id: event.id, question: event.question, options: event.options } });
      break;
    case "log":
      actions.appendStream({ kind: "assistant", text: event.text });
      break;
  }
}
