import { app } from "electron";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillInfo } from "@shared/types";
import { loadSettings } from "../settings";

/**
 * Skills 资源管理。
 * 内置的 mm-* 数学建模 skills 随应用分发（resources/skills），
 * 用户可在设置页导入额外 skills 目录（如新版工作流快照）。
 * 所有 skills 经由 DefaultResourceLoader.skillsOverride 注入 pi 会话。
 */

/** 内置 skills 目录（打包后为 <安装目录>/resources/skills，开发态为项目 resources/skills） */
export function bundledSkillsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "skills");
  // 开发态主产物为 <项目根>/out/main/index.js
  return join(fileURLToPath(new URL("../../resources", import.meta.url)), "skills");
}

interface RawSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

/** 解析 SKILL.md 的 frontmatter（仅提取 name / description） */
function parseSkillMd(filePath: string): { name?: string; description?: string } {
  try {
    const text = readFileSync(filePath, "utf-8");
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const fm = m[1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    return { name, description };
  } catch {
    return {};
  }
}

/** 扫描一个 skills 根目录：每个一级子目录若含 SKILL.md 即为一个 skill */
function scanSkillsRoot(root: string): RawSkill[] {
  const found: RawSkill[] = [];
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory() || entry.startsWith(".")) continue;
      const skillMd = join(dir, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const fm = parseSkillMd(skillMd);
      if (!fm.name) continue;
      found.push({
        name: fm.name,
        description: fm.description ?? "",
        filePath: skillMd,
        baseDir: dir,
      });
    } catch {
      // 跳过不可访问的目录
    }
  }
  return found;
}

/** 收集全部可用 skills：内置 + 用户导入目录 */
export function collectSkills(): SkillInfo[] {
  const settings = loadSettings();
  const all: SkillInfo[] = [];

  for (const s of scanSkillsRoot(bundledSkillsDir())) {
    all.push({ name: s.name, description: s.description, dir: s.baseDir, imported: false });
  }
  for (const dir of settings.skillDirs) {
    for (const s of scanSkillsRoot(dir)) {
      // 内置同名 skill 优先；导入的同名项忽略
      if (all.some((x) => x.name === s.name)) continue;
      all.push({ name: s.name, description: s.description, dir: s.baseDir, imported: true });
    }
  }
  return all;
}
