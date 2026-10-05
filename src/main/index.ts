import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { applyRuntimePath } from "./env";
import { handleFileProtocol, registerFileProtocol } from "./protocol";
import { disposePipeline, registerIpcHandlers } from "./ipc";

/**
 * Mathmodel-PI 主进程入口。
 * 职责：窗口与协议注册、运行环境（PATH）准备、IPC 装配。
 * 业务逻辑分布在 agent/（pi 会话与流水线）、projects.ts（项目）与 env.ts（环境）。
 */

// mmfile:// 协议的特权声明必须发生在 app ready 之前
registerFileProtocol();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    title: "Mathmodel-PI",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  // 渲染进程日志转发到终端，便于排查（仅 warning/error）
  win.webContents.on("console-message", (event) => {
    const detail = event as unknown as { level?: unknown; message?: string };
    const level = typeof detail.level === "string" ? detail.level : String((event as unknown as { level: number }).level ?? "");
    if (level === "error" || level === "warning" || level === "2" || level === "3") {
      console.log(`[renderer:${level}] ${detail.message ?? ""}`);
    }
  });
  win.webContents.on("preload-error", (_e, path, error) => {
    console.error(`[preload-error] ${path}: ${error}`);
  });

  // 外部链接一律走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(async () => {
  // 将内置 Python 与本机 TeX 前置到 PATH，供 pi 派生进程使用
  await applyRuntimePath();

  registerIpcHandlers();
  handleFileProtocol();

  // 打包环境下 pi 的 resources 引用
  if (process.resourcesPath && existsSync(join(process.resourcesPath, "skills"))) {
    process.env.MM_BUNDLED_SKILLS = join(process.resourcesPath, "skills");
  }

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  disposePipeline();
});
