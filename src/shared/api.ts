import type {
  AppSettings,
  ChatMessage,
  ChatSessionMeta,
  EnvReport,
  FileContent,
  FileTreeNode,
  KbSource,
  ModelInfo,
  PipelineEvent,
  ProviderInfo,
  RunOptions,
  SkillInfo,
  StageInfo,
} from "./types";

/**
 * 渲染进程可用 API 契约。
 * preload 负责实现（contextBridge），渲染进程通过 window.api 调用。
 */

export interface RunSnapshot {
  status: "idle" | "running" | "finished" | "failed" | "aborted";
  stages: StageInfo[];
}

/** 对话事件（主进程 → 渲染进程，均带会话 id） */
export type ChatEvent =
  | { type: "user"; sessionId: string; text: string; ts: number }
  | { type: "assistant"; sessionId: string; text: string; ts: number }
  | { type: "info"; sessionId: string; text: string; ts: number }
  | { type: "text"; sessionId: string; delta: string }
  | { type: "tool"; sessionId: string; callId: string; name: string; status: "start" | "done"; argsPreview?: string; resultPreview?: string; ok?: boolean }
  | { type: "busy"; sessionId: string; busy: boolean }
  | { type: "sessions"; sessions: ChatSessionMeta[] };

/** 持久化转录行（含工具行） */
export interface ChatLine extends ChatMessage {
  kind?: "tool";
  toolName?: string;
  toolStatus?: "start" | "done";
  argsPreview?: string;
  resultPreview?: string;
  ok?: boolean;
}

export interface Api {
  // 设置与环境
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  checkEnv(): Promise<EnvReport>;

  // 模型与 Skills
  listModels(): Promise<ModelInfo[]>;
  listProviders(): Promise<ProviderInfo[]>;
  listSkills(): Promise<SkillInfo[]>;
  importSkillsDir(): Promise<{ dir: string; count: number } | null>;

  // 对话（主界面）
  listChatSessions(): Promise<ChatSessionMeta[]>;
  /** 不传 cwd 时使用“上次使用的文件夹”，全新用户兜底到用户目录 */
  createChatSession(cwd?: string): Promise<ChatSessionMeta>;
  /** 会话尚未开始对话时可更改工作目录 */
  setChatCwd(id: string, cwd: string): Promise<ChatSessionMeta>;
  deleteChatSession(id: string): Promise<void>;
  getChatTranscript(id: string): Promise<ChatLine[]>;
  chatSend(id: string, text: string): Promise<void>;
  chatAbort(id: string): Promise<void>;
  isChatBusy(id: string): Promise<boolean>;

  // 知识库
  kbList(): Promise<KbSource[]>;
  kbSelectPath(): Promise<string | null>;
  kbImportPath(path: string): Promise<{ source: KbSource; files: number }>;
  kbDeleteSource(id: string): Promise<void>;

  // 项目管理（工作流视图）
  selectDirectory(defaultPath?: string): Promise<string | null>;
  selectProblemFile(): Promise<string | null>;
  createProject(parentDir: string, name: string): Promise<{ path: string }>;
  listRecentProjects(): Promise<string[]>;
  openProject(projectPath: string): Promise<FileTreeNode>;
  readFile(path: string): Promise<FileContent>;
  openPath(path: string): Promise<void>;

  // 流水线执行（工作流视图）
  startRun(opts: RunOptions): Promise<void>;
  runStage(projectPath: string, stageKey: string, model: string): Promise<void>;
  abortRun(): Promise<void>;
  answerAsk(id: string, answer: string): Promise<void>;
  snapshot(): Promise<RunSnapshot>;

  // 执行流事件
  onPipelineEvent(listener: (event: PipelineEvent) => void): () => void;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;

  // 应用信息
  appVersion(): Promise<string>;
}
