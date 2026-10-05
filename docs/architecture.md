# 架构设计

本文说明 Mathmodel-PI 的分层结构、关键数据流与设计取舍。

## 1. 总体分层

```
渲染进程（React）     —— 纯 UI，不接触 Node 能力
preload（contextBridge）—— 类型化 API 契约（src/shared/api.ts）
主进程（Electron）    —— 业务逻辑：pi 会话、流水线编排、项目与环境管理
```

跨进程通信只有两条通道：

- **请求/响应**：渲染进程经 `window.api.*`（IPC invoke）调用主进程；
- **事件推送**：主进程将流水线事件（`PipelineEvent`）经 `pipeline:event` 广播到渲染进程。

两条通道的数据结构均定义在 `src/shared/`，为唯一权威契约。

## 2. pi 集成方式

pi（`@earendil-works/pi-coding-agent`）以 SDK 形式在主进程内嵌运行：

- **会话工厂**（`src/main/agent/session.ts`）：
  - `ModelRuntime.create()` 后将用户在各 provider 下配置的 API Key 经 `setRuntimeApiKey` 注入，Key 不落盘到 pi 自身的 auth 存储；
  - `DefaultResourceLoader` 指定 `skillsOverride`，skills 全部来自应用内置目录（`resources/skills`）与用户导入目录，屏蔽用户全局 pi 配置的干扰；`agentDir` 指向应用私有目录（`%APPDATA%/Mathmodel-PI/pi-agent`）；
  - 通过内联扩展注册 `ask_user` 工具，承接工作流 skills 中的用户交互点；
  - Windows 下同时启用 `bash` 与 `powershell` 工具，用户环境缺少 bash 时仍可执行命令。
- **会话不持久化**（`SessionManager.inMemory()`）：流水线的权威状态是项目目录中的产物（`project-manifest.json`、docs/、paper/ 等），而非对话历史。中断后从对应阶段重跑即可恢复，避免双重状态源。

## 3. 流水线编排

阶段依赖固定为 mm-orchestrator 定义串行链：`analysis → modeling → coding → paper_plan → (figures ∥ graphics) → paper_final（两轮）→ verification`。

- **全自动模式**：单会话以 `/skill:mm-orchestrator` 启动，由编排 skill 自己调度全部阶段。启动前 UI 收集题目文件、附件、侧重点、子问题数量；运行期间 `ask_user` 依据预设自动应答，不中断执行。
- **单步模式**：每阶段独立会话，`/skill:<stage-skill>` 精确执行；`paper_plan` 阶段由编排器亲自执行，prompt 中显式限定只做策划、不调度其他阶段。
- **状态同步**：`PipelineRunner` 对项目根目录做 `fs.watch`，监听 `project-manifest.json` 的 `stages.{key}.status`（防抖 500ms），映射为 UI 阶段状态推送。

## 4. ask_user 交互工具

工作流 skills 中编排器需要确认「侧重点 / 子问题数量」，GATE 检查需要确认放行。为此注册统一工具 `ask_user(question, options)`：

| 模式 | 行为 |
|---|---|
| 全自动 | 按预设偏好自动应答（关键词匹配侧重点/子问题，兜底返回默认偏好） |
| 单步 | 主进程挂起工具执行，弹窗推送渲染进程，用户作答后 resolve |

## 5. 本地环境策略

| 组件 | 策略 | 理由 |
|---|---|---|
| Python | 内置便携版（python-build-standalone + 科学计算库），前置 PATH | 公开分发门槛低；机检脚本与建模代码开箱即跑 |
| XeLaTeX | 检测本机 MiKTeX/TeX Live 并前置 PATH；缺失时引导安装 | 发行版体积大（1~3 GB），不适合内置 |
| pdftocairo | 仅检测并提示 | TikZ/SVG 渲染需要，通常随 poppler 安装 |

## 6. 文件协议与安全

- 渲染进程预览图片/PDF 走自定义 `mmfile://` 协议：主进程维护「已登记项目根目录」白名单，路径规范化后做前缀校验，阻断目录穿越。
- API Key 存储于 `%APPDATA%/Mathmodel-PI/settings.json`，仅在本机使用。
- CSP 禁止远程资源加载；外部链接一律转交系统浏览器。

## 7. 已知取舍

- **单会话全自动**依赖模型长上下文与 pi 的自动压缩（compaction）；对超长赛程，后续可改为应用级阶段编排（每阶段独立会话已在单步模式验证）。
- **文件树深度限制 4 层、条目 500**：防止大型 results 目录卡顿 UI；完整目录可经「打开目录」在资源管理器查看。
- **执行流不落盘**：刷新后执行流清空，产物不受影响；会话持久化在 Roadmap 中。
