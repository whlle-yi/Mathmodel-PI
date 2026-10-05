/**
 * 主进程与渲染进程共享的类型定义（IPC 契约）。
 * 所有跨进程通信的数据结构以本文件为唯一权威。
 */

/** 流水线阶段键名，与 project-manifest.json 的 stages 键一致 */
export type StageKey =
  | "analysis"
  | "modeling"
  | "coding"
  | "paper_plan"
  | "figures"
  | "graphics"
  | "paper_final"
  | "verification";

/** 阶段执行状态 */
export type StageStatus = "pending" | "running" | "complete" | "failed" | "n_a";

export interface StageInfo {
  key: StageKey;
  /** 中文名称 */
  label: string;
  /** 负责的 skill */
  skill: string;
  status: StageStatus;
}

/** 执行模式 */
export type RunMode = "auto" | "step";

/** 一键全自动模式的启动参数 */
export interface RunOptions {
  /** 项目（赛题工作目录）绝对路径 */
  projectPath: string;
  mode: RunMode;
  /** 题目文件绝对路径（已复制到项目 data/ 目录） */
  problemFile?: string;
  /** 附件目录绝对路径（已复制到项目 data/ 目录） */
  attachmentsDir?: string;
  /** 侧重点：精度优先 / 可解释性优先 / 速度优先 / 均衡 */
  focus: string;
  /** 子问题数量："auto" 表示由赛题分析确定 */
  subproblems: string;
  /** 模型，格式 "provider/model" */
  model: string;
  /** 思考力度 */
  thinkingLevel: ThinkingLevel;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 环境检测结果 */
export interface EnvReport {
  python: {
    found: boolean;
    path?: string;
    version?: string;
    bundled: boolean;
    /** 关键科学计算库可用性 */
    packages: Record<string, boolean>;
  };
  xelatex: {
    found: boolean;
    path?: string;
    version?: string;
  };
  pdftocairo: {
    found: boolean;
    path?: string;
  };
}

/** 模型信息 */
export interface ModelInfo {
  /** "provider/model" */
  id: string;
  provider: string;
  model: string;
  name: string;
  /** 该 provider 下的模型是否普遍具备视觉输入能力（赛题核验需要） */
  vision: boolean;
}

/** Provider 元信息（设置页展示用） */
export interface ProviderInfo {
  id: string;
  label: string;
  vision: boolean;
}

/** Skill 概要 */
export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  /** 是否来自用户导入目录 */
  imported: boolean;
}

/** 执行流中的事件（主进程 → 渲染进程） */
export type PipelineEvent =
  | { type: "run"; status: "running" | "finished" | "failed" | "aborted"; mode?: RunMode; error?: string }
  | { type: "text"; delta: string }
  | { type: "assistant-message"; text: string }
  | {
      type: "tool";
      /** 事件实例 id，用于配对 start/end */
      callId: string;
      name: string;
      status: "start" | "done";
      argsPreview?: string;
      resultPreview?: string;
      ok?: boolean;
    }
  | { type: "stages"; stages: StageInfo[] }
  | { type: "ask"; id: string; question: string; options: string[] }
  | { type: "log"; text: string };

/** 项目文件树节点 */
export interface FileTreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: FileTreeNode[];
  /** 字节数（file） */
  size?: number;
}

/** 应用设置 */
export interface AppSettings {
  /** providerId -> API Key */
  providers: Record<string, string>;
  /** 默认模型 "provider/model" */
  defaultModel?: string;
  thinkingLevel: ThinkingLevel;
  /** 用户导入的 skills 目录 */
  skillDirs: string[];
  /** 最近项目列表 */
  recentProjects: string[];
  /** 首次引导是否完成 */
  onboardingDone: boolean;
}

/** 预览文件类型 */
export type PreviewKind = "markdown" | "image" | "pdf" | "code" | "text" | "unsupported";

/** 预览文件内容（projects.readFileForPreview 的返回） */
export interface FileContent {
  kind: PreviewKind;
  /** 文本内容（markdown/code/text） */
  content?: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否因过大而截断 */
  truncated: boolean;
}

// ============================================================
// 对话（主界面）
// ============================================================

/** 一次对话会话的元信息 */
export interface ChatSessionMeta {
  id: string;
  /** 标题（默认取首条消息截断） */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 该会话智能体的工作目录 */
  cwd: string;
  messageCount: number;
}

/** 会话历史中的一条消息（持久化与重载用） */
export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "info";
  text: string;
  ts: number;
}

/** 知识库来源条目 */
export interface KbSource {
  id: string;
  /** 来源名（文件名或目录名） */
  name: string;
  path: string;
  /** 切块数量 */
  chunks: number;
  /** 索引时间 */
  indexedAt: number;
}
