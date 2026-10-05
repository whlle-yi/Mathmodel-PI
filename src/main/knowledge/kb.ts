import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { KbSource } from "@shared/types";

/**
 * 本地知识库：用户导入的资料（PDF/DOCX/MD/TXT）→ 文本提取 → 切块 →
 * SQLite 持久化 + 内存 BM25 检索。全部离线，数据不出本机。
 *
 * 中文检索采用字符二元切词（bigram）配 BM25 打分：无分词依赖、对
 * 中文学术文本可用；语义级检索（向量）在 Roadmap 中。
 */

interface Chunk {
  sourceId: string;
  sourceName: string;
  path: string;
  text: string;
}

interface Db {
  db: DatabaseSync;
  chunks: Chunk[];
  sources: KbSource[];
}

let cache: Db | null = null;

function kbDir(): string {
  const dir = join(app.getPath("userData"), "kb");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dbPath(): string {
  return join(kbDir(), "kb.sqlite3");
}

function openDb(): Db {
  if (cache) return cache;
  const db = new DatabaseSync(dbPath());
  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    path TEXT NOT NULL,
    text TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    chunks INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
  )`);
  const chunkRows = db.prepare("SELECT source_id, source_name, path, text FROM chunks").all() as Array<{
    source_id: string; source_name: string; path: string; text: string;
  }>;
  const sourceRows = db.prepare("SELECT id, name, path, chunks, indexed_at FROM sources").all() as Array<{
    id: string; name: string; path: string; chunks: number; indexed_at: number;
  }>;
  cache = {
    db,
    chunks: chunkRows.map((r) => ({ sourceId: r.source_id, sourceName: r.source_name, path: r.path, text: r.text })),
    sources: sourceRows.map((r) => ({ id: r.id, name: r.name, path: r.path, chunks: r.chunks, indexedAt: r.indexed_at })),
  };
  return cache;
}

// ---------------------------------------------------------------- 文本提取

/** 应用资源目录（打包后 <安装>/resources；开发态为项目 resources/） */
function appResources(): string {
  if (app.isPackaged) return process.resourcesPath;
  return fileURLToPath(new URL("../../resources", import.meta.url));
}

const EXTRACT_SCRIPT = join(appResources(), "kb", "extract_text.py");

function bundledPython(): string {
  return join(appResources(), "python", "python.exe");
}

/** 调用便携 Python 提取 PDF/DOCX 文本（纯文本类不走 Python） */
function extractTextFile(path: string): Promise<string> {
  const ext = path.toLowerCase();
  if (ext.endsWith(".pdf") || ext.endsWith(".docx")) {
    return new Promise((resolve, reject) => {
      execFile(bundledPython(), [EXTRACT_SCRIPT, path], { timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`${path}: ${stderr || err.message}`));
          else resolve(stdout);
        });
    });
  }
  return Promise.resolve(readFileSync(path, "utf-8"));
}

const TEXT_EXTS = new Set([".pdf", ".docx", ".md", ".markdown", ".txt"]);

async function collectTexts(target: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  const st = statSync(target);
  const files: string[] = [];
  if (st.isFile()) {
    files.push(target);
  } else {
    const walk = (dir: string, depth: number) => {
      if (depth > 4) return;
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || entry === "__pycache__" || entry === "node_modules") continue;
        const full = join(dir, entry);
        let s;
        try { s = statSync(full); } catch { continue; }
        if (s.isDirectory()) walk(full, depth + 1);
        else if (TEXT_EXTS.has(entry.slice(entry.lastIndexOf(".")).toLowerCase())) files.push(full);
      }
    };
    walk(target, 0);
  }
  for (const f of files) {
    try {
      const text = await extractTextFile(f);
      if (text.trim()) out.push({ path: f, text });
    } catch (err) {
      console.warn(`[kb] 提取失败 ${f}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

/** 切块：约 800 字符一块，相邻块重叠 100 字符 */
function chunkText(text: string): string[] {
  const SIZE = 800;
  const OVERLAP = 100;
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + SIZE));
    start += SIZE - OVERLAP;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

// ---------------------------------------------------------------- 检索

/** 分词：拉丁词 + 中文字符二元（bigram） */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const latin = text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
  tokens.push(...latin);
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk.slice(i, i + 2));
  return tokens;
}

function bm25Search(query: string, chunks: Chunk[], k: number): Chunk[] {
  const k1 = 1.5;
  const b = 0.75;
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];

  const docsTokens = chunks.map((c) => tokenize(c.text));
  const avgLen = docsTokens.reduce((s, t) => s + t.length, 0) / Math.max(1, docsTokens.length);
  const df = new Map<string, number>();
  for (const tokens of docsTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = chunks.length;

  const scored = chunks.map((chunk, i) => {
    const tf = new Map<string, number>();
    for (const t of docsTokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTokens) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docsTokens[i].length / avgLen)));
    }
    return { chunk, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map((s) => s.chunk);
}

// ---------------------------------------------------------------- 公共 API

export function kbSources(): KbSource[] {
  return openDb().sources;
}

export async function kbImport(target: string): Promise<{ source: KbSource; files: number }> {
  const db = openDb();
  const texts = await collectTexts(target);
  if (texts.length === 0) throw new Error("未找到可提取的文件（支持 PDF/DOCX/MD/TXT）");

  const id = `kb-${Date.now()}`;
  const name = target.split(/[\\/]/).filter(Boolean).pop() ?? target;
  let count = 0;
  const insert = db.db.prepare("INSERT INTO chunks (source_id, source_name, path, text) VALUES (?, ?, ?, ?)");
  for (const { path, text } of texts) {
    for (const chunk of chunkText(text)) {
      insert.run(id, name, path, chunk);
      db.chunks.push({ sourceId: id, sourceName: name, path, text: chunk });
      count += 1;
    }
  }
  const source: KbSource = { id, name, path: target, chunks: count, indexedAt: Date.now() };
  db.db.prepare("INSERT INTO sources (id, name, path, chunks, indexed_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, target, count, source.indexedAt);
  db.sources.push(source);
  return { source, files: texts.length };
}

export function kbDelete(sourceId: string): void {
  const db = openDb();
  db.db.prepare("DELETE FROM chunks WHERE source_id = ?").run(sourceId);
  db.db.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
  db.chunks = db.chunks.filter((c) => c.sourceId !== sourceId);
  db.sources = db.sources.filter((s) => s.id !== sourceId);
}

/** 供 search_knowledge_base 工具调用；返回带来源标注的文本块 */
export function kbSearch(query: string, k = 5): Array<{ text: string; source: string; path: string }> {
  const db = openDb();
  if (db.chunks.length === 0) return [];
  return bm25Search(query, db.chunks, k).map((c) => ({
    text: c.text,
    source: c.sourceName,
    path: c.path,
  }));
}

export function kbIsSupported(path: string): boolean {
  return existsSync(path);
}
