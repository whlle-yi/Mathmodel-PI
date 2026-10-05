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
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunOptions, ThinkingLevel } from "@shared/types";
import { loadSettings } from "../settings";
import { bundledSkillsDir } from "./skills";
import { kbSearch } from "../knowledge/kb";

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

/** search_knowledge_base：在用户导入的本地知识库中检索相关片段 */
function makeKnowledgeBaseExtension() {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "search_knowledge_base",
      label: "检索知识库",
      description:
        "在本地知识库（内置数学建模知识 + 用户导入的论文/教材/笔记）中检索与查询最相关的文本片段，返回带来源标注的结果。回答专业问题、核对竞赛规范、选择模型方法之前都应先检索。",
      parameters: Type.Object({
        query: Type.String({ description: "检索关键词或问题描述" }),
        top_k: Type.Optional(Type.Number({ description: "返回条数，默认 5" })),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const results = kbSearch(params.query, params.top_k ?? 5);
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "知识库中没有相关内容。可提示用户在 设置 → 知识库 中导入资料。" }],
            details: { count: 0 },
          };
        }
        const text = results
          .map((r, i) => `[${i + 1}] 来源：${r.source}（${r.path}）\n${r.text}`)
          .join("\n\n---\n\n");
        return {
          content: [{ type: "text", text }],
          details: { count: results.length },
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
  /** 注册 search_knowledge_base 检索工具（对话与工作流会话均可用） */
  knowledgeBase?: boolean;
  /** 不注入的 skill 名单（如对话场景屏蔽 mm-orchestrator） */
  excludeSkills?: string[];
}

export async function createMMSession(opts: CreateMMSessionOptions): Promise<AgentSession> {
  const settings = loadSettings();

  // 1. 模型运行时：注入用户在各 provider 下配置的 API Key。
  //    凭据存储隔离到应用私有目录（不读用户 pi CLI 的 ~/.pi/agent/auth.json）；
  //    各 provider 的标准环境变量（如 DEEPSEEK_API_KEY）仍按 pi 约定生效
  const authPath = join(app.getPath("userData"), "pi-agent", "auth.json");
  const modelRuntime = await ModelRuntime.create({ authPath });
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

  // 2. 资源加载：skills 与指令按作用域合并
  //    优先级（同名就近覆盖）：项目 .mp > 全局 .mp > 设置导入 > 应用内置
  const agentDir = join(app.getPath("userData"), "pi-agent");
  const globalMp = join(homedir(), ".mp");
  const projectMp = join(opts.cwd, ".mp");

  const skillRoots: string[] = [
    bundledSkillsDir(),
    ...settings.skillDirs,
    join(globalMp, "skills"),
    join(projectMp, "skills"),
  ];
  const merged = new Map<string, Skill>();
  for (const [i, dir] of skillRoots.entries()) {
    if (!existsSync(dir)) continue;
    const { skills } = await loadSkillsFromDir({ dir, source: i === 0 ? "builtin" : i === skillRoots.length - 1 ? "project" : "user" });
    for (const skill of skills) {
      if (opts.excludeSkills?.includes(skill.name)) continue;
      merged.set(skill.name, skill); // 后加载的作用域覆盖先前的同名项
    }
  }
  const allSkills = [...merged.values()];

  // 指令文件：全局 ~/.mp/AGENTS.md + 项目 <cwd>/.mp/AGENTS.md（存在才注入）
  const instructionFiles: Array<{ path: string; content: string }> = [];
  for (const file of [join(globalMp, "AGENTS.md"), join(projectMp, "AGENTS.md")]) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8").trim();
        if (content) instructionFiles.push({ path: file, content });
      } catch {
        // 读不到就跳过
      }
    }
  }

  const factories = [makeAskUserExtension(opts.askCtx)];
  if (opts.knowledgeBase) factories.push(makeKnowledgeBaseExtension());

  const resourceLoader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
    skillsOverride: () => ({ skills: allSkills, diagnostics: [] }),
    agentsFilesOverride: (current) => ({
      agentsFiles: [...current.agentsFiles, ...instructionFiles],
    }),
    extensionFactories: factories,
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
