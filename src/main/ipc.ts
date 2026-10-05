import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ChatEvent, ChatLine } from "@shared/api";
import type {
  AppSettings,
  ChatSessionMeta,
  EnvReport,
  FileContent,
  FileTreeNode,
  KbSource,
  ModelInfo,
  PipelineEvent,
  RunOptions,
  SkillInfo,
} from "@shared/types";
import { loadSettings, saveSettings } from "./settings";
import { checkEnvironment } from "./env";
import { PROVIDERS } from "./providers";
import { isStageKey } from "@shared/stages";
import { collectSkills } from "./agent/skills";
import { PipelineRunner } from "./agent/pipeline";
import { ChatService } from "./agent/chat";
import * as kb from "./knowledge/kb";
import {
  buildFileTree,
  createProject,
  importProblemMaterials,
  openInExplorer,
  readFileForPreview,
  selectDirectory,
  selectProblemFile,
} from "./projects";
import { registerAllowedRoot } from "./protocol";

/**
 * IPC 接口层：渲染进程的全部能力请求都经由这里进入主进程。
 * 事件方向（流水线执行流 / 对话流）通过 webContents.send 推送。
 */

const runner = new PipelineRunner({
  emit: (event: PipelineEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("pipeline:event", event);
    }
  },
});

const chat = new ChatService((event: ChatEvent) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("chat:event", event);
  }
});

/** 将项目根目录登记为 mmfile:// 可访问范围（图片/PDF 预览） */
function allowProjectRoot(projectPath: string): void {
  registerAllowedRoot(projectPath);
}

async function listModels(): Promise<ModelInfo[]> {
  const settings = loadSettings();
  const runtime = await ModelRuntime.create();
  for (const [provider, key] of Object.entries(settings.providers)) {
    if (key) runtime.setRuntimeApiKey(provider, key);
  }
  const available = await runtime.getAvailable();
  return available.map((m) => ({
    id: `${m.provider}/${m.id}`,
    provider: m.provider,
    model: m.id,
    name: (m as { displayName?: string }).displayName ?? m.id,
    vision: true,
  }));
}

export function registerIpcHandlers(): void {
  // ---- 设置与环境 -------------------------------------------------------
  ipcMain.handle("settings:get", (): AppSettings => loadSettings());
  ipcMain.handle("settings:set", (_e, patch: Partial<AppSettings>): AppSettings => saveSettings(patch));
  ipcMain.handle("env:check", (): Promise<EnvReport> => checkEnvironment());

  // ---- 模型与 Skills ----------------------------------------------------
  ipcMain.handle("models:list", (): Promise<ModelInfo[]> => listModels());
  ipcMain.handle("providers:list", () => PROVIDERS);
  ipcMain.handle("skills:list", (): SkillInfo[] => collectSkills());

  ipcMain.handle("skills:importDir", async (): Promise<{ dir: string; count: number } | null> => {
    const dir = await selectDirectory();
    if (!dir) return null;
    const settings = loadSettings();
    if (!settings.skillDirs.includes(dir)) {
      saveSettings({ skillDirs: [...settings.skillDirs, dir] });
    }
    return { dir, count: collectSkills().length };
  });

  // ---- 项目管理 ----------------------------------------------------------
  ipcMain.handle("project:create", (_e, parentDir: string, name: string) => {
    const { path } = createProject(parentDir, name);
    allowProjectRoot(path);
    return { path };
  });
  ipcMain.handle("project:selectDir", () => selectDirectory());
  ipcMain.handle("project:selectProblemFile", () => selectProblemFile());
  ipcMain.handle("project:listRecent", () => loadSettings().recentProjects);
  ipcMain.handle("project:open", (_e, projectPath: string) => {
    registerAllowedRoot(projectPath);
    return buildFileTree(projectPath);
  });
  ipcMain.handle("project:tree", (_e, projectPath: string): FileTreeNode => buildFileTree(projectPath));
  ipcMain.handle("project:readFile", (_e, path: string): FileContent => readFileForPreview(path));
  ipcMain.handle("project:openPath", (_e, path: string) => openInExplorer(path));

  // ---- 流水线执行 ----------------------------------------------------------
  ipcMain.handle("run:start", async (_e, opts: RunOptions) => {
    // 题目与附件复制进项目 data/，后续 prompt 使用项目内路径
    const imported = importProblemMaterials(opts.projectPath, opts.problemFile, opts.attachmentsDir);
    allowProjectRoot(opts.projectPath);
    await runner.startAuto({
      ...opts,
      problemFile: imported.problemFile?.replaceAll("\\", "/"),
      attachmentsDir: imported.attachmentsDir?.replaceAll("\\", "/"),
    });
  });

  ipcMain.handle("run:stage", async (_e, projectPath: string, stageKey: string, model: string) => {
    if (!isStageKey(stageKey)) throw new Error(`未知阶段：${stageKey}`);
    const settings = loadSettings();
    await runner.runStage(projectPath, stageKey, model, settings.thinkingLevel);
  });

  ipcMain.handle("run:abort", () => runner.abort());
  ipcMain.handle("run:answer", (_e, id: string, answer: string) => runner.answer(id, answer));
  ipcMain.handle("run:snapshot", () => runner.snapshot());

  // ---- 对话（主界面） ------------------------------------------------------
  ipcMain.handle("chat:list", (): ChatSessionMeta[] => chat.listSessions());
  ipcMain.handle("chat:create", (_e, cwd?: string): ChatSessionMeta => {
    const session = chat.createSession(cwd ?? loadSettings().workspaceDir);
    registerAllowedRoot(session.cwd);
    return session;
  });
  ipcMain.handle("chat:delete", (_e, id: string) => chat.deleteSession(id));
  ipcMain.handle("chat:transcript", (_e, id: string): ChatLine[] => chat.getTranscript(id));
  ipcMain.handle("chat:send", async (_e, id: string, text: string) => {
    const meta = chat.listSessions().find((s) => s.id === id);
    if (meta) registerAllowedRoot(meta.cwd);
    await chat.send(id, text);
  });
  ipcMain.handle("chat:abort", (_e, id: string) => chat.abort(id));
  ipcMain.handle("chat:busy", (_e, id: string) => chat.isBusy(id));

  // ---- 知识库 --------------------------------------------------------------
  ipcMain.handle("kb:list", (): KbSource[] => kb.kbSources());
  ipcMain.handle("kb:import", async (_e, path: string) => kb.kbImport(path));
  ipcMain.handle("kb:delete", (_e, id: string) => kb.kbDelete(id));
  ipcMain.handle("kb:selectPath", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "openFile", "multiSelections"],
      filters: [{ name: "资料", extensions: ["pdf", "docx", "md", "txt"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ---- 应用信息 ----------------------------------------------------------
  ipcMain.handle("app:version", () => app.getVersion());
}

export function disposePipeline(): void {
  runner.dispose();
}