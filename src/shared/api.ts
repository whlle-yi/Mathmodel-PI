import type {
  AppSettings,
  EnvReport,
  FileContent,
  FileTreeNode,
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

  // 项目管理
  selectDirectory(): Promise<string | null>;
  selectProblemFile(): Promise<string | null>;
  createProject(parentDir: string, name: string): Promise<{ path: string }>;
  listRecentProjects(): Promise<string[]>;
  openProject(projectPath: string): Promise<FileTreeNode>;
  readFile(path: string): Promise<FileContent>;
  openPath(path: string): Promise<void>;

  // 流水线执行
  startRun(opts: RunOptions): Promise<void>;
  runStage(projectPath: string, stageKey: string, model: string): Promise<void>;
  abortRun(): Promise<void>;
  answerAsk(id: string, answer: string): Promise<void>;
  snapshot(): Promise<RunSnapshot>;

  // 执行流事件
  onPipelineEvent(listener: (event: PipelineEvent) => void): () => void;

  // 应用信息
  appVersion(): Promise<string>;
}
