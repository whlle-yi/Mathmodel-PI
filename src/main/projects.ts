import { dialog, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, cpSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { FileContent, FileTreeNode, PreviewKind } from "@shared/types";
import { touchRecentProject } from "./settings";

/**
 * 项目（赛题工作目录）管理。
 * 一个项目对应一次数学建模的完整工作区：data/ 放题目与附件，
 * docs/ code/ results/ figures/ paper/ 等由工作流 skill 按约定生成。
 */

/** 预览无关文件，避免文件树过大 */
const TREE_SKIP = new Set(["__pycache__", "node_modules", ".git", ".mm-sessions", "aux_files"]);
const TEXT_EXTS = new Set([
  ".md", ".txt", ".json", ".py", ".tex", ".bib", ".sty", ".cls", ".csv", ".tsv",
  ".js", ".ts", ".m", ".sh", ".bat", ".yml", ".yaml", ".log", ".xml", ".html",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".bmp"]);

export function previewKind(path: string): PreviewKind {
  const ext = extname(path).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "code";
  return "text";
}

export async function selectDirectory(defaultPath?: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    defaultPath,
  });
  return result.canceled ? null : result.filePaths[0];
}

export async function selectProblemFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "赛题文件", extensions: ["pdf", "docx", "doc", "png", "jpg", "jpeg", "md", "txt"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
}

/** 新建项目目录并登记到最近列表 */
export function createProject(parentDir: string, name: string): { path: string } {
  const safeName = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名项目";
  const projectPath = join(parentDir, safeName);
  if (existsSync(projectPath)) {
    throw new Error(`目录已存在：${projectPath}`);
  }
  mkdirSync(join(projectPath, "data"), { recursive: true });
  touchRecentProject(projectPath);
  return { path: projectPath };
}

/** 将题目文件与附件目录复制到项目 data/ 下，返回 data 目录内的新路径 */
export function importProblemMaterials(
  projectPath: string,
  problemFile?: string,
  attachmentsDir?: string,
): { problemFile?: string; attachmentsDir?: string } {
  const dataDir = join(projectPath, "data");
  mkdirSync(dataDir, { recursive: true });
  let newProblem: string | undefined;
  let newAttachments: string | undefined;

  if (problemFile && existsSync(problemFile)) {
    newProblem = join(dataDir, basename(problemFile));
    copyFileSync(problemFile, newProblem);
  }
  if (attachmentsDir && existsSync(attachmentsDir)) {
    newAttachments = join(dataDir, basename(attachmentsDir));
    cpSync(attachmentsDir, newAttachments, { recursive: true });
  }
  return { problemFile: newProblem, attachmentsDir: newAttachments };
}

/** 构建项目文件树（限制深度与数量，避免超大目录卡死 UI） */
export function buildFileTree(root: string, maxDepth = 4): FileTreeNode {
  const LIMIT = 500;
  let count = 0;

  function walk(dir: string, depth: number): FileTreeNode {
    const node: FileTreeNode = { name: basename(dir) || dir, path: dir, kind: "dir", children: [] };
    if (depth >= maxDepth || count > LIMIT) return node;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return node;
    }
    entries.sort((a, b) => a.localeCompare(b, "zh-CN"));
    for (const entry of entries) {
      if (count > LIMIT) {
        node.children!.push({ name: "…", path: "", kind: "file" });
        break;
      }
      if (TREE_SKIP.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      count += 1;
      if (st.isDirectory()) {
        node.children!.push(walk(full, depth + 1));
      } else {
        node.children!.push({ name: entry, path: full, kind: "file", size: st.size });
      }
    }
    return node;
  }

  return walk(root, 0);
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** 读取文件用于预览（文本类限 2MB，二进制类由渲染进程经 mmfile:// 协议加载） */
export function readFileForPreview(path: string): FileContent {
  const kind = previewKind(path);
  const st = statSync(path);
  if (kind === "image" || kind === "pdf") {
    return { kind, size: st.size, truncated: false };
  }
  if (st.size > MAX_TEXT_BYTES) {
    const content = readFileSync(path, "utf-8").slice(0, MAX_TEXT_BYTES);
    return { kind, content, size: st.size, truncated: true };
  }
  return { kind, content: readFileSync(path, "utf-8"), size: st.size, truncated: false };
}

export function openInExplorer(path: string): void {
  shell.openPath(path);
}
