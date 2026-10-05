import { protocol } from "electron";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

/**
 * mmfile:// 自定义协议：向渲染进程安全地提供项目文件（图片、PDF 预览）。
 * 仅允许访问已登记的项目根目录与内置 skills 资源目录内的文件，
 * 路径规范化后做前缀校验，阻断目录穿越。
 */

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".css": "text/css",
};

const allowedRoots = new Set<string>();

export function registerAllowedRoot(root: string): void {
  allowedRoots.add(resolve(root) + sep);
}

export function unregisterAllowedRoot(root: string): void {
  allowedRoots.delete(resolve(root) + sep);
}

export function registerFileProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "mmfile", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

export function handleFileProtocol(): void {
  protocol.handle("mmfile", (request) => {
    // URL 形如 mmfile://local/D%3A%2Fprojects%2Fpaper.pdf —— host 固定为 local
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const abs = resolve(normalize(filePath));

    const allowed = [...allowedRoots].some((root) => abs.startsWith(root));
    if (!allowed || !existsSync(abs) || !statSync(abs).isFile()) {
      return new Response("Not found", { status: 404 });
    }
    const mime = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
    return new Response(stream, { headers: { "content-type": mime } });
  });
}
