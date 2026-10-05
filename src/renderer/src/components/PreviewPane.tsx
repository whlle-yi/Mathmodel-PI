import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { actions, useApp } from "../store";
import type { FileContent, FileTreeNode } from "@shared/types";

/**
 * 产物预览区：左侧项目文件树 + 右侧查看器。
 * 文本类直接渲染；图片与 PDF 经 mmfile:// 协议加载（仅限已登记项目目录）。
 */

function mmfileUrl(path: string): string {
  return `mmfile://local/${encodeURIComponent(path.replaceAll("\\", "/"))}`;
}

function TreeItem({ node, depth }: { node: FileTreeNode; depth: number }): React.ReactNode {
  const [expanded, setExpanded] = useState(depth < 1);
  const selectedPath = useApp().selectedFile;

  if (node.kind === "file") {
    if (!node.path) return <div className="tree-more">…</div>;
    return (
      <div
        className={`tree-file ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => actions.setState({ selectedFile: node.path })}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }
  return (
    <div>
      <div
        className="tree-dir"
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "▾" : "▸"} {node.name}
      </div>
      {expanded &&
        node.children?.map((child) => (
          <TreeItem key={child.path || child.name} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

/** 简易净化：移除脚本与事件属性（预览内容来自本地项目文件） */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "");
}

function FileViewer({ path, content }: { path: string; content: FileContent }): React.ReactNode {
  const html = useMemo(
    () => (content.kind === "markdown" ? sanitize(marked.parse(content.content ?? "", { async: false })) : ""),
    [content],
  );

  if (content.kind === "image") {
    return <img className="preview-image" src={mmfileUrl(path)} alt={path} />;
  }
  if (content.kind === "pdf") {
    return <iframe className="preview-pdf" src={mmfileUrl(path)} title={path} />;
  }
  if (content.kind === "markdown") {
    return (
      <div
        className="preview-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="preview-code">
      {content.content}
      {content.truncated ? "\n\n…（文件过大，已截断）" : ""}
    </pre>
  );
}

export function PreviewPane(): React.ReactNode {
  const app = useApp();
  const path = app.selectedFile;

  let viewer: React.ReactNode = <div className="preview-empty muted">点击左侧文件以预览产物</div>;
  if (path) {
    viewer = <PreviewLoader path={path} />;
  }

  return (
    <aside className="preview">
      <div className="preview-tree">
        <div className="preview-tree-head">
          <span>项目文件</span>
          {app.projectPath && (
            <button className="btn tiny ghost" onClick={() => void window.api.openPath(app.projectPath!)}>
              打开目录
            </button>
          )}
        </div>
        {app.tree ? <TreeItem node={app.tree} depth={0} /> : <div className="muted pad">未打开项目</div>}
      </div>
      <div className="preview-viewer">{viewer}</div>
    </aside>
  );
}

function PreviewLoader({ path }: { path: string }): React.ReactNode {
  const [state, setState] = useState<{ content?: FileContent; error?: string }>({});
  const tree = useApp().tree;

  useEffect(() => {
    let cancelled = false;
    setState({});
    window.api
      .readFile(path)
      .then((content) => {
        if (!cancelled) setState({ content });
      })
      .catch((err) => {
        if (!cancelled) setState({ error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, tree]);

  if (state.error) return <div className="preview-empty muted">无法读取：{state.error}</div>;
  if (!state.content) return <div className="preview-empty muted">加载中…</div>;
  return (
    <div className="preview-file">
      <div className="preview-file-head">{path}</div>
      <FileViewer path={path} content={state.content} />
    </div>
  );
}
