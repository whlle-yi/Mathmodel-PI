#!/usr/bin/env node
/**
 * 下载便携 Python 运行时到 resources/python/（发布打包用）。
 *
 * 使用 python-build-standalone（astral-sh 维护的独立发行版），
 * 安装后额外预装数学建模工作流所需的核心科学计算库。
 *
 * 用法：npm run fetch-python [-- --version=3.12]
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PYTHON_VERSION = "3.12.10";
const BUILD = "20250409";
const PLATFORM = "x86_64-pc-windows-msvc";
const DEST = join(fileURLToPath(new URL("..", import.meta.url)), "resources", "python");

const fileName = `cpython-${PYTHON_VERSION}+${BUILD}-${PLATFORM}-install_only.tar.gz`;
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${BUILD}/${fileName}`;

console.log(`下载 ${fileName} …`);

function download(target) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败：HTTP ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(target);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(u);
  });
}

if (existsSync(DEST)) {
  console.log(`已存在 ${DEST}，如需重装请先删除该目录。`);
  process.exit(0);
}

const tmp = join(DEST, "..", "_python.tar.gz");
await download(tmp);

rmSync(DEST, { recursive: true, force: true });
execFileSync("tar", ["-xzf", tmp, "-C", DEST, "--strip-components=1"]);
rmSync(tmp, { force: true });

console.log("安装核心科学计算库（numpy/pandas/scipy/matplotlib/pymupdf/openpyxl）…");
execFileSync(join(DEST, "python.exe"), ["-m", "pip", "install", "--no-warn-script-location",
  "numpy", "pandas", "scipy", "matplotlib", "pymupdf", "openpyxl"], { stdio: "inherit" });

console.log(`完成：${DEST}`);
