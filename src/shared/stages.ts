import type { StageKey, StageInfo } from "./types";

/**
 * 流水线阶段定义（与 mm-orchestrator 的固定阶段依赖一致）。
 * 顺序即编排顺序；figures 与 graphics 在实际执行中为并行分支。
 */
export const STAGE_DEFS: Omit<StageInfo, "status">[] = [
  { key: "analysis", label: "赛题分析", skill: "mm-problem-analysis" },
  { key: "modeling", label: "建模求解", skill: "mm-modeling" },
  { key: "coding", label: "编程实现", skill: "mm-coding" },
  { key: "paper_plan", label: "论文策划", skill: "mm-orchestrator" },
  { key: "figures", label: "数据图", skill: "mm-figures" },
  { key: "graphics", label: "非数据图", skill: "mm-graphics" },
  { key: "paper_final", label: "论文终稿", skill: "mm-paper-writing" },
  { key: "verification", label: "验收", skill: "mm-verification" },
];

export function initialStages(): StageInfo[] {
  return STAGE_DEFS.map((s) => ({ ...s, status: "pending" as const }));
}

export function isStageKey(value: string): value is StageKey {
  return STAGE_DEFS.some((s) => s.key === value);
}

/**
 * 工作流专属 skills（对话会话不装配——完整工作流只能从工作流视图进入）。
 * 注意 mm-model-dictionary 不在流水线阶段里，但也属于工作流体系。
 */
export const WORKFLOW_SKILLS = [
  "mm-orchestrator",
  "mm-problem-analysis",
  "mm-modeling",
  "mm-model-dictionary",
  "mm-coding",
  "mm-figures",
  "mm-graphics",
  "mm-paper-writing",
  "mm-verification",
];

