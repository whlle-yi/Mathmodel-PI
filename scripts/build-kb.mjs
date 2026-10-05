#!/usr/bin/env node
/**
 * 构建内置知识索引（发布/开发前运行）。
 *
 * 按 resources/knowledge/manifest.json 的 include/exclude 规则，
 * 扫描 knowledge/（纯知识）与各 skill 的 references/（知识型文件），
 * 切块后写入 resources/kb-index/builtin.sqlite3（只读，随安装包分发）。
 *
 * 用法：npm run build-kb
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RESOURCES = fileURLToPath(new URL("../resources", import.meta.url));
const MANIFEST = join(RESOURCES, "knowledge", "manifest.json");
const OUT_DIR = join(RESOURCES, "kb-index");
const OUT = join(OUT_DIR, "builtin.sqlite3");

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

// ---------------------------------------------------------------- 简易 glob

/** 只支持 **、*、? 三种通配，够 manifest 使用 */
function globToRegex(pattern) {
  const re = pattern
    .split(/[\\/]/)
    .map((seg) =>
      seg
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^\\\\/]*")
        .replace(/\?/g, "[^\\\\/]")
        .replace(/\u0000/g, ".*"),
    )
    .join("[\\\\/]");
  return new RegExp(`^${re}$`, "i");
}

// ---------------------------------------------------------------- 收集文件

function collectFiles(rootDir, includePatterns, excludePatterns) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (entry === "__pycache__" || entry.startsWith(".")) continue;
        walk(full);
      } else {
        files.push(full);
      }
    }
  };
  if (existsSync(rootDir)) walk(rootDir);
  const rel = (f) => relative(RESOURCES, f).split(sep).join("/");
  return files.filter((f) => {
    const p = rel(f);
    return includePatterns.some((g) => g.test(p)) && !excludePatterns.some((g) => g.test(p));
  });
}

// ---------------------------------------------------------------- 切块

function chunkText(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

// ---------------------------------------------------------------- 主流程

const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
const include = manifest.include.map(globToRegex);
const exclude = manifest.exclude.map(globToRegex);

const files = collectFiles(RESOURCES, include, exclude);
console.log(`命中 ${files.length} 个知识文件`);

mkdirSync(OUT_DIR, { recursive: true });
rmSync(OUT, { force: true });
const db = new DatabaseSync(OUT);
db.exec(`CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT NOT NULL
)`);

const insert = db.prepare("INSERT INTO chunks (source_name, path, text) VALUES (?, ?, ?)");
let chunks = 0;
for (const file of files) {
  const rel = relative(RESOURCES, file).split(sep).join("/");
  // source_name 取到 skill 名或 knowledge 子目录，便于引用标注
  const parts = rel.split("/");
  const sourceName = parts[0] === "skills" ? `skills/${parts[1]}` : `knowledge/${parts[1] ?? ""}`;
  let text;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    continue;
  }
  for (const chunk of chunkText(text)) {
    insert.run(sourceName, rel, chunk);
    chunks += 1;
  }
}
db.close();

const size = (statSync(OUT).size / 1024).toFixed(1);
console.log(`完成：${chunks} 个片段 → ${rel0(OUT)}（${size} KB）`);

function rel0(p) {
  return relative(process.cwd(), p).split(sep).join("/");
}
