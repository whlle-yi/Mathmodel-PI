import {
  createAgentSession,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { app } from "electron";
import { join } from "node:path";
import type { RunOptions, ThinkingLevel } from "@shared/types";
import { loadSettings } from "../settings";
import { bundledSkillsDir } from "./skills";

/**
 * pi 会话工厂。
 * 每个流水线阶段 / 一次全自动运行对应一个独立会话：
 * - skills 由应用内置目录 + 用户导入目录注入（覆盖 pi 默认发现）
 * - API Key 由应用设置注入 ModelRuntime（不落 pi 自身的 auth 存储）
 * - 注册 ask_user 自定义工具承接工作流中的用户交互点
 */

export interface AskUserContext {
  /** 是否为全自动模式（自动应答预设偏好） */
  auto: boolean;
  /** 全自动模式下的预设偏好应答 */
  defaults: Pick<RunOptions, "focus" | "subproblems">;
  /** 单步模式下向用户提问（返回 resolved 的答案文本） */
  ask: (question: string, options: string[]) => Promise<string>;
}

export interface SessionEventHandlers {
  onEvent: (event: AgentSessionEvent) => void;
}

function autoAnswer(question: string, defaults: Pick<RunOptions, "focus" | "subproblems">): string {
  const q = question.toLowerCase();
  if (question.includes("侧重点") || /focus|priority/.test(q)) {
    return defaults.focus || "精度优先";
  }
  if (question.includes("子问题") || /sub-?problem/.test(q)) {
    return defaults.subproblems === "auto" ? "子问题数量待赛题分析确定" : `题目共 ${defaults.subproblems} 个子问题`;
  }
  return `按默认处理：侧重点 ${defaults.focus || "精度优先"}，子问题数量${
    defaults.subproblems === "auto" ? "待赛题分析确定" : `共 ${defaults.subproblems} 个`
  }。`;
}

/** 扩展 API 中用到的最小工具注册接口 */
function makeAskUserExtension(ctx: AskUserContext) {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ask_user",
      label: "询问用户",
      description:
        "向用户提出工作流偏好确认问题（如侧重点、子问题数量）。调用后返回用户的选择文本。当需要用户决策时必须使用本工具，不要自行假设。",
      parameters: Type.Object({
        question: Type.String({ description: "要向用户提出的问题" }),
        options: Type.Array(Type.String(), { description: "供用户选择的选项列表" }),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const answer = ctx.auto
          ? autoAnswer(params.question, ctx.defaults)
          : await ctx.ask(params.question, params.options);
        return {
          content: [{ type: "text", text: answer }],
          details: { answer },
        };
      },
    });
  };
}

export interface CreateMMSessionOptions {
  cwd: string;
  askCtx: AskUserContext;
  onEvent: (event: AgentSessionEvent) => void;
  /** 运行时提示（模型回退等），转发到执行流 */
  onLog?: (text: string) => void;
  /** 模型，格式 "provider/model"；缺省时用设置中的默认模型 */
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

export async function createMMSession(opts: CreateMMSessionOptions): Promise<AgentSession> {
  const settings = loadSettings();

  // 1. 模型运行时：注入用户在各 provider 下配置的 API Key
  const modelRuntime = await ModelRuntime.create();
  for (const [provider, key] of Object.entries(settings.providers)) {
    if (key) modelRuntime.setRuntimeApiKey(provider, key);
  }

  let model = undefined;
  const modelId = opts.model ?? settings.defaultModel;
  if (modelId && modelId.includes("/")) {
    const [provider, id] = modelId.split("/", 2);
    model = modelRuntime.getModel(provider, id) ?? undefined;
    if (!model) opts.onLog?.(`未找到模型 ${modelId}，回退到默认模型`);
  }

  // 2. 资源加载：skills 全部来自应用内置与用户导入目录；
  //    agentDir 指向应用私有目录，避免读取用户全局 pi 配置
  const agentDir = join(app.getPath("userData"), "pi-agent");
  const merged = new Map<string, Skill>();
  const roots: Array<{ dir: string; source: string }> = [
    { dir: bundledSkillsDir(), source: "builtin" },
    ...settings.skillDirs.map((d) => ({ dir: d, source: "imported" })),
  ];
  for (const root of roots) {
    const { skills } = await loadSkillsFromDir({ dir: root.dir, source: root.source });
    for (const skill of skills) {
      if (!merged.has(skill.name)) merged.set(skill.name, skill);
    }
  }
  const allSkills = [...merged.values()];

  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    skillsOverride: () => ({ skills: allSkills, diagnostics: [] }),
    extensionFactories: [makeAskUserExtension(opts.askCtx)],
  });
  await resourceLoader.reload();

  // 3. 创建会话：会话不持久化（流水线状态以项目文件为权威，见 docs/architecture.md）；
  //    Windows 下同时启用 bash 与 powershell，用户环境缺 bash 时仍可执行命令
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    tools: ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"],
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    model,
    thinkingLevel: opts.thinkingLevel ?? settings.thinkingLevel,
    resourceLoader,
  });

  session.subscribe(opts.onEvent);
  return session;
}
