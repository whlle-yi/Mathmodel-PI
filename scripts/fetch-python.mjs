#!/usr/bin/env node
/**
 * 下载便携 Python 运行时到 resources/python/（发布打包用）。
 *
 * 使用 python-build-standalone（astral-sh 维护的独立发行版），
 * 安装后额外预装数学建模工作流所需的核心科学计算库。
 *
 * 用法：PIP_INDEX_URL=<镜像> npm run fetch-python
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PYTHON_VERSION = "3.12.10";
const BUILD = "20250409";
const PLATFORM = "x86_64-pc-windows-msvc";
const DEST = join(fileURLToPath(new URL("..", import.meta.url)), "resources", "python");

const fileName = `cpython-${PYTHON_VERSION}+${BUILD}-${PLATFORM}-install_only.tar.gz`;
// 主源用国内镜像，GitHub 官方源兜底
const SOURCES = [
  `https://registry.npmmirror.com/-/binary/python-build-standalone/${BUILD}/${fileName}`,
  `https://github.com/astral-sh/python-build-standalone/releases/download/${BUILD}/${fileName}`,
];

if (existsSync(join(DEST, "python.exe"))) {
  console.log(`已存在 ${DEST}，如需重装请先删除该目录。`);
  process.exit(0);
}

console.log(`下载 ${fileName} …`);
const tmp = join(DEST, "..", "_python.tar.gz");

/** 下载单个源，带 3 次重试；每次下载后用 tar 列表校验归档完整性（防截断） */
async function downloadVerified(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) console.log(`  重试第 ${attempt - 1} 次…`);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      execFileSync("tar", ["-tzf", tmp], { stdio: "ignore" });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

let lastError = null;
for (const url of SOURCES) {
  try {
    console.log(`尝试源：${new URL(url).host}`);
    await downloadVerified(url);
    lastError = null;
    break;
  } catch (err) {
    lastError = err;
    console.warn(`源失败：${err.message}`);
  }
}
if (lastError) {
  rmSync(tmp, { force: true });
  throw lastError;
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
execFileSync("tar", ["-xzf", tmp, "-C", DEST, "--strip-components=1"]);
rmSync(tmp, { force: true });

console.log("安装核心科学计算库（numpy/pandas/scipy/matplotlib/pymupdf/openpyxl）…");
execFileSync(join(DEST, "python.exe"), ["-m", "pip", "install", "--no-warn-script-location",
  "numpy", "pandas", "scipy", "matplotlib", "pymupdf", "openpyxl"], { stdio: "inherit" });

console.log(`完成：${DEST}`);
