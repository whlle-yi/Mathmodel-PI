import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "@shared/api";

/**
 * 预加载桥：以类型化 API 形式向渲染进程暴露主进程能力。
 * 渲染进程只允许通过 window.api 访问主进程，禁止直接接触 Node 能力。
 */

const api: Api = {
  // 设置与环境
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  checkEnv: () => ipcRenderer.invoke("env:check"),

  // 模型与 Skills
  listModels: () => ipcRenderer.invoke("models:list"),
  listProviders: () => ipcRenderer.invoke("providers:list"),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  importSkillsDir: () => ipcRenderer.invoke("skills:importDir"),

  // 项目管理
  selectDirectory: () => ipcRenderer.invoke("project:selectDir"),
  selectProblemFile: () => ipcRenderer.invoke("project:selectProblemFile"),
  createProject: (parentDir, name) => ipcRenderer.invoke("project:create", parentDir, name),
  listRecentProjects: () => ipcRenderer.invoke("project:listRecent"),
  openProject: (projectPath) => ipcRenderer.invoke("project:open", projectPath),
  readFile: (path) => ipcRenderer.invoke("project:readFile", path),
  openPath: (path) => ipcRenderer.invoke("project:openPath", path),

  // 流水线执行
  startRun: (opts) => ipcRenderer.invoke("run:start", opts),
  runStage: (projectPath, stageKey, model) => ipcRenderer.invoke("run:stage", projectPath, stageKey, model),
  abortRun: () => ipcRenderer.invoke("run:abort"),
  answerAsk: (id, answer) => ipcRenderer.invoke("run:answer", id, answer),
  snapshot: () => ipcRenderer.invoke("run:snapshot"),

  // 执行流事件
  onPipelineEvent: (listener) => {
    const handler = (_e: unknown, event: Parameters<typeof listener>[0]): void => listener(event);
    ipcRenderer.on("pipeline:event", handler);
    return () => ipcRenderer.removeListener("pipeline:event", handler);
  },

  // 应用信息
  appVersion: () => ipcRenderer.invoke("app:version"),
};

contextBridge.exposeInMainWorld("api", api);
