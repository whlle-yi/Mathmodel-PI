import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AppSettings } from "@shared/types";

/**
 * 应用设置的持久化存储。
 * 存放于系统用户数据目录（%APPDATA%/Mathmodel-PI/settings.json），
 * 与项目工作目录、pi 运行时目录相互隔离。
 */

const DEFAULT_SETTINGS: AppSettings = {
  providers: {},
  defaultModel: undefined,
  thinkingLevel: "medium",
  skillDirs: [],
  recentProjects: [],
  onboardingDone: false,
};

let cached: AppSettings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    cached = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached as AppSettings;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  cached = { ...current, ...patch };
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cached, null, 2), "utf-8");
  return cached;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  return saveSettings(patch);
}

export function settingsFileExists(): boolean {
  return existsSync(settingsPath());
}

/** 记录最近项目（去重、置顶、上限 20 个） */
export function touchRecentProject(projectPath: string): void {
  const current = loadSettings();
  const list = [projectPath, ...current.recentProjects.filter((p) => p !== projectPath)].slice(0, 20);
  saveSettings({ recentProjects: list });
}
