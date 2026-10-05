import { watch, existsSync, readFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PipelineEvent, RunOptions, StageInfo, StageKey } from "@shared/types";
import { initialStages, isStageKey } from "@shared/stages";
import { createMMSession, type AskUserContext } from "./session";

/**
 * 流水线执行器。
 *
 * - 全自动模式：单个会话以 /skill:mm-orchestrator 启动，由编排 skill 调度全部阶段；
 *   阶段状态从 project-manifest.json 的 stages 字段实时同步。
 * - 单步模式：每个阶段一个独立会话，通过 /skill:<stage-skill> 精确执行该阶段。
 *
 * 两种模式的执行状态都以项目目录中的产物（manifest / docs / paper）为权威，
 * 会话本身不持久化，中断后可从对应阶段重跑（见 docs/architecture.md）。
 */

const STAGE_SKILL: Record<StageKey, string> = {
  analysis: "mm-problem-analysis",
  modeling: "mm-modeling",
  coding: "mm-coding",
  paper_plan: "mm-orchestrator",
  figures: "mm-figures",
  graphics: "mm-graphics",
  paper_final: "mm-paper-writing",
  verification: "mm-verification",
};

const STAGE_LABEL: Record<StageKey, string> = {
  analysis: "赛题分析",
  modeling: "建模求解",
  coding: "编程实现",
  paper_plan: "论文策划",
  figures: "数据图",
  graphics: "非数据图",
  paper_final: "论文终稿",
  verification: "验收",
};

type RunStatus = "idle" | "running" | "finished" | "failed" | "aborted";

export interface PipelineEmitter {
  emit(event: PipelineEvent): void;
}

export class PipelineRunner {
  private session: AgentSession | null = null;
  private status: RunStatus = "idle";
  private manifestWatcher: FSWatcher | null = null;
  private projectPath = "";
  private currentStages = initialStages();
  private pendingAsks = new Map<string, (answer: string) => void>();
  private askSeq = 0;

  constructor(private readonly emitter: PipelineEmitter) {}

  get runStatus(): RunStatus {
    return this.status;
  }

  get stages(): StageInfo[] {
    return this.currentStages;
  }

  /** 推送当前阶段状态快照 */
  private pushStages(): void {
    this.emitter.emit({ type: "stages", stages: this.currentStages });
  }

  // ---------------------------------------------------------------- 用户交互

  /** ask_user 工具的单步模式入口：弹窗等待用户作答 */
  private askUser = (question: string, options: string[]): Promise<string> => {
    return new Promise((resolve) => {
      const id = `ask-${++this.askSeq}`;
      this.pendingAsks.set(id, resolve);
      this.emitter.emit({ type: "ask", id, question, options });
    });
  };

  /** 渲染进程回传的答案 */
  answer(id: string, answer: string): void {
    const resolve = this.pendingAsks.get(id);
    if (resolve) {
      this.pendingAsks.delete(id);
      resolve(answer);
    }
  }

  // ---------------------------------------------------------------- manifest

  /** 监听 project-manifest.json，把阶段状态同步到 UI */
  private watchManifest(projectPath: string): void {
    this.unwatchManifest();
    this.projectPath = projectPath;
    const manifestPath = join(projectPath, "project-manifest.json");
    let debounce: NodeJS.Timeout | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => this.syncManifest(manifestPath), 500);
    };
    try {
      this.manifestWatcher = watch(projectPath, { persistent: false }, (_event, filename) => {
        const name = Array.isArray(filename) ? filename[0] : filename;
        if (!name || name === "project-manifest.json") schedule();
      });
      // 立即同步一次
      this.syncManifest(manifestPath);
    } catch {
      // 项目目录不存在等情况：忽略
    }
  }

  private unwatchManifest(): void {
    this.manifestWatcher?.close();
    this.manifestWatcher = null;
  }

  private syncManifest(manifestPath: string): void {
    try {
      if (!existsSync(manifestPath)) return;
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        stages?: Record<string, { status?: string }>;
      };
      let changed = false;
      for (const stage of this.currentStages) {
        const manifestStatus = raw.stages?.[stage.key]?.status;
        if (!manifestStatus) continue;
        const mapped = this.mapManifestStatus(manifestStatus);
        if (mapped && mapped !== stage.status) {
          stage.status = mapped;
          changed = true;
        }
      }
      if (changed) this.pushStages();
    } catch {
      // manifest 尚未写入或暂不可解析：忽略
    }
  }

  private mapManifestStatus(raw: string): StageInfo["status"] | null {
    switch (raw) {
      case "pending":
        return "pending";
      case "in_progress":
        return "running";
      case "complete":
        return "complete";
      case "failed":
        return "failed";
      case "n_a":
        return "n_a";
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- 事件转发

  private static preview(value: unknown, limit = 400): string {
    const text =
      typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2) ?? "";
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  }

  private handleSessionEvent = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.emitter.emit({ type: "text", delta: event.assistantMessageEvent.delta });
        }
        break;
      case "message_end": {
        const msg = event.message as { role?: string; content?: unknown };
        if (msg.role === "assistant") {
          const text = Array.isArray(msg.content)
            ? msg.content
                .filter((b) => (b as { type?: string }).type === "text")
                .map((b) => (b as { text?: string }).text ?? "")
                .join("")
            : "";
          if (text.trim()) this.emitter.emit({ type: "assistant-message", text });
        }
        break;
      }
      case "tool_execution_start":
        this.emitter.emit({
          type: "tool",
          callId: event.toolCallId,
          name: event.toolName,
          status: "start",
          argsPreview: PipelineRunner.preview(event.args),
        });
        break;
      case "tool_execution_end":
        this.emitter.emit({
          type: "tool",
          callId: event.toolCallId,
          name: event.toolName,
          status: "done",
          resultPreview: PipelineRunner.preview(
            (event.result as { content?: unknown })?.content ?? event.result,
          ),
          ok: !event.isError,
        });
        break;
      default:
        break;
    }
  };

  // ---------------------------------------------------------------- 执行入口

  private async createSession(opts: RunOptions & { auto: boolean }): Promise<AgentSession> {
    const askCtx: AskUserContext = {
      auto: opts.auto,
      defaults: { focus: opts.focus, subproblems: opts.subproblems },
      ask: this.askUser,
    };
    return createMMSession({
      cwd: opts.projectPath,
      askCtx,
      onEvent: this.handleSessionEvent,
      onLog: (text) => this.emitter.emit({ type: "log", text }),
      model: opts.model,
      thinkingLevel: opts.thinkingLevel,
    });
  }

  private async runSession(session: AgentSession, prompt: string): Promise<void> {
    try {
      await session.prompt(prompt);
      this.status = "finished";
      this.emitter.emit({ type: "run", status: "finished" });
    } catch (err) {
      this.status = "failed";
      const message = err instanceof Error ? err.message : String(err);
      this.emitter.emit({ type: "run", status: "failed", error: message });
    } finally {
      this.unwatchManifest();
      session.dispose();
      this.session = null;
    }
  }

  /**
   * 全自动模式：以 mm-orchestrator 为总控入口跑完整条流水线。
   * 题目文件与附件应已就位于项目 data/ 目录。
   */
  async startAuto(opts: RunOptions): Promise<void> {
    if (this.status === "running") throw new Error("已有任务在执行中");
    this.status = "running";
    this.currentStages = initialStages();
    this.pushStages();
    this.emitter.emit({ type: "run", status: "running", mode: "auto" });
    this.watchManifest(opts.projectPath);

    const attachments = opts.attachmentsDir ? opts.attachmentsDir : "（无附件）";
    const subproblems =
      opts.subproblems === "auto" ? "待赛题分析确定" : `已知共 ${opts.subproblems} 个`;

    const prompt = [
      "/skill:mm-orchestrator",
      "",
      "开始执行全国大学生数学建模竞赛（CUMCM）全流程。",
      `- 题目文件：${opts.problemFile ?? "（未提供，请向用户索要）"}`,
      `- 附件目录：${attachments}`,
      `- 用户偏好：侧重点 ${opts.focus}；子问题数量${subproblems}`,
      "- 编程语言：Python（默认，不询问）",
      "",
      "当前工作目录即 PROJECT_ROOT，题目与附件已就位。请从第 1 步执行到第 7 步验收，",
      "期间如需向用户提问请使用 ask_user 工具；除关键偏好外不要中断执行。",
    ].join("\n");

    const session = await this.createSession({ ...opts, auto: true });
    this.session = session;
    await this.runSession(session, prompt);
  }

  /** 单步模式：精确执行一个阶段 */
  async runStage(projectPath: string, stageKey: StageKey, model: string, thinkingLevel: RunOptions["thinkingLevel"]): Promise<void> {
    if (this.status === "running") throw new Error("已有任务在执行中");
    if (!isStageKey(stageKey)) throw new Error(`未知阶段：${stageKey}`);
    this.status = "running";
    this.emitter.emit({ type: "run", status: "running", mode: "step" });
    this.watchManifest(projectPath);

    const stage = this.currentStages.find((s) => s.key === stageKey);
    if (stage) {
      stage.status = "running";
      this.pushStages();
    }

    const isOrchestrator = stageKey === "paper_plan";
    const skillName = STAGE_SKILL[stageKey];
    const stagePrompt = isOrchestrator
      ? [
          "/skill:mm-orchestrator",
          "",
          `当前工作目录即 PROJECT_ROOT。分析、建模、编程阶段（docs/01~03、code/、results/）已完成，`,
          "本次仅执行【论文策划定稿】（编排工作流第 3 步中的正式策划部分）：初稿审计、结构规划、页面预算与图件骨架，",
          "并通过 validate_paper_plan.py 校验后将 paper_plan 置为 complete。不要调用其他阶段 skill。",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `/skill:${skillName}`,
          "",
          `当前工作目录即 PROJECT_ROOT，本次仅执行【${STAGE_LABEL[stageKey]}】阶段。`,
          "请先读取 plan.md 与 project-manifest.json 确认上游产物状态，然后完整执行本阶段，",
          "运行全部机检脚本（PASS 以脚本 exit 0 为准）并回写 manifest。需要提问时使用 ask_user 工具。",
          stageKey === "paper_final"
            ? "注意：本阶段必须按 skill 要求连续执行两轮独立的完整终稿（pass-1 与 pass-2）。"
            : "",
        ]
          .filter(Boolean)
          .join("\n");

    const opts: RunOptions = {
      projectPath,
      mode: "step",
      focus: "精度优先",
      subproblems: "auto",
      model,
      thinkingLevel,
    };
    const session = await this.createSession({ ...opts, auto: false });
    this.session = session;
    await this.runSession(session, stagePrompt);
  }

  /** 中止当前执行 */
  async abort(): Promise<void> {
    if (this.session) {
      await this.session.abort();
      this.status = "aborted";
      this.emitter.emit({ type: "run", status: "aborted" });
    }
  }

  /** 恢复阶段面板初始快照（窗口刷新时用） */
  snapshot(): { status: RunStatus; stages: StageInfo[] } {
    return { status: this.status, stages: this.currentStages };
  }

  dispose(): void {
    this.unwatchManifest();
    this.session?.dispose();
    this.session = null;
  }
}
