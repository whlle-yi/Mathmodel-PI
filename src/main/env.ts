import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { EnvReport } from "@shared/types";

/**
 * 本地运行环境检测：便携 Python 与 XeLaTeX 发行版。
 * 数学建模 skills 的机检脚本依赖 Python（含 numpy/pandas/matplotlib/PyMuPDF 等），
 * 论文编译与 TikZ 渲染依赖 XeLaTeX（MiKTeX/TeX Live）与 pdftocairo（poppler）。
 */

/** 应用自带的便携 Python 根目录（打包后位于 resources/python） */
export function bundledPythonDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "python");
  return join(app.getAppPath(), "resources", "python");
}

function bundledPythonExe(): string | null {
  const dir = bundledPythonDir();
  const exe = join(dir, "python.exe");
  return existsSync(exe) ? exe : null;
}

function runCapture(cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "utf-8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

/** 在 PATH 与常见安装位置中定位 xelatex，返回其目录与可执行文件路径 */
export async function locateXelatex(): Promise<string | null> {
  const where = await runCapture("where", ["xelatex"]);
  if (where.ok) {
    const first = where.stdout.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  }
  const candidates: string[] = [];
  const localAppData = process.env.LOCALAPPDATA ?? "";
  for (const base of [localAppData, "C:\\Program Files", "C:\\Program Files (x86)", "C:\\", "D:\\"]) {
    if (!base) continue;
    candidates.push(
      join(base, "Programs", "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"),
      join(base, "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"),
    );
  }
  for (const disk of ["C", "D"]) {
    for (const year of ["2025", "2024", "2023"]) {
      candidates.push(join(`${disk}:\\`, "texlive", year, "bin", "windows", "xelatex.exe"));
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function locateOnPath(tool: string): Promise<string | null> {
  const where = await runCapture("where", [tool]);
  if (where.ok) {
    const first = where.stdout.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  }
  return null;
}

/** 建模代码常用的科学计算库（缺库时引导用户安装） */
const REQUIRED_PACKAGES = ["numpy", "pandas", "scipy", "matplotlib", "fitz"];

export async function checkEnvironment(): Promise<EnvReport> {
  // 1. Python：优先内置便携版
  const bundled = bundledPythonExe();
  let pythonExe = bundled;
  let version: string | undefined;
  let packages: Record<string, boolean> = {};

  if (bundled) {
    const v = await runCapture(bundled, ["--version"]);
    version = v.stdout.trim() || undefined;
  } else {
    const sysPy = await locateOnPath("python");
    if (sysPy) {
      pythonExe = sysPy;
      const v = await runCapture(sysPy, ["--version"]);
      version = v.stdout.trim() || undefined;
    }
  }

  if (pythonExe) {
    const check = await runCapture(
      pythonExe,
      ["-c", `import importlib.util,sys
for m in ${JSON.stringify(REQUIRED_PACKAGES)}:
    print(m, bool(importlib.util.find_spec(m)))`],
    );
    if (check.ok) {
      for (const line of check.stdout.split(/\r?\n/)) {
        const [name, ok] = line.trim().split(/\s+/);
        if (name) packages[name] = ok === "True";
      }
    }
  }

  // 2. XeLaTeX
  const xelatexPath = await locateXelatex();
  let xelatexVersion: string | undefined;
  if (xelatexPath) {
    const v = await runCapture(xelatexPath, ["--version"]);
    xelatexVersion = (v.stdout || v.stderr).split(/\r?\n/)[0]?.trim();
  }

  // 3. pdftocairo（TikZ/SVG 渲染用；缺失仅为警告）
  const pdftocairoPath = await locateOnPath("pdftocairo");

  return {
    python: {
      found: Boolean(pythonExe),
      path: pythonExe ?? undefined,
      version,
      bundled: Boolean(bundled),
      packages,
    },
    xelatex: {
      found: Boolean(xelatexPath),
      path: xelatexPath ?? undefined,
      version: xelatexVersion,
    },
    pdftocairo: {
      found: Boolean(pdftocairoPath),
      path: pdftocairoPath ?? undefined,
    },
  };
}

/**
 * 将内置 Python 与检测到的 TeX 发行版前置到 PATH，
 * 使 pi 派生的 bash/脚本进程可以直接调用 python / xelatex。
 */
export async function applyRuntimePath(): Promise<{ xelatexDir?: string }> {
  const paths: string[] = [];

  const pyDir = bundledPythonDir();
  if (existsSync(join(pyDir, "python.exe"))) {
    paths.push(pyDir, join(pyDir, "Scripts"));
  }

  const xelatex = await locateXelatex();
  if (xelatex) paths.push(join(xelatex, ".."));

  if (paths.length > 0) {
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = [...paths, process.env.PATH ?? ""].join(sep);
  }
  return { xelatexDir: xelatex ? join(xelatex, "..") : undefined };
}
