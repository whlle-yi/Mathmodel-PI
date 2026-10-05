# Mathmodel-PI

基于开源智能体框架 [pi](https://github.com/badlogic/pi-mono) 的**数学建模竞赛智能体工作台**（桌面应用）。

Mathmodel-PI 将 pi 智能体运行时嵌入 Electron 桌面应用，配合一套 CUMCM（全国大学生数学建模竞赛）建模工作流 Skills，为参赛者提供从赛题分析到论文终稿的一站式自动化工作环境。

## 功能特性

- **一键全流程**：提交题目与偏好后，智能体按 `赛题分析 → 建模求解 → 编程实现 → 论文策划 → 数据图/非数据图 → 论文终稿（两轮）→ 验收` 的固定流水线连续执行，期间不打断。
- **单步执行**：流水线面板支持对任意阶段单独运行，便于复跑、返工与人工把关。
- **工作台式界面**：执行流实时展示（智能体文本、工具调用、机检脚本结果）+ 项目产物预览（Markdown / 图表 / PDF 论文 / 代码）。
- **流水线可视化**：阶段状态从 `project-manifest.json` 实时同步，机检 PASS 以脚本 exit 0 为准，不轻信手写结论。
- **多模型接入**：支持智谱 GLM、Anthropic Claude、OpenAI GPT、Google Gemini、DeepSeek、Moonshot Kimi、通义千问、xAI Grok、OpenRouter 等服务商，API Key 仅保存在本机。
- **开箱即用**：内置便携 Python 运行时与全部建模 Skills；检测到本机 XeLaTeX 后即可编译论文，未检测到时提供安装指引。
- **Skills 可扩展**：内置最新版工作流 Skills，支持在设置中导入自定义 Skills 目录以随工作流演进。

## 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11（x64） |
| 内存 | ≥ 8 GB |
| 网络 | 需访问所选模型服务商的 API |
| 论文编译 | MiKTeX 或 TeX Live（应用启动时自动检测，缺失时引导安装） |

## 快速开始（用户）

1. 下载最新安装包（`dist/` 下的 NSIS 安装程序），按向导安装。
2. 启动后完成首次引导：确认环境检测结果 → 配置至少一家模型服务商的 API Key。
3. 新建项目 → 选择赛题文件（PDF/DOCX/图片）与附件 → 点击「一键运行全流程」。
4. 在执行流中观察进度，在右侧预览区查看分析报告、图件与论文 PDF。

详细说明见 [docs/user-guide.md](docs/user-guide.md)。

## 快速开始（开发者）

```bash
# 环境要求：Node.js ≥ 22, npm ≥ 10

npm install                # 安装依赖（如 Electron 二进制下载失败，见 docs/development.md）

npm run dev                # 开发模式（主进程热重载 + 渲染进程 HMR）
npm run typecheck          # 两端 TypeScript 类型检查
npm run build              # 构建三端产物

npm run fetch-python       # 下载便携 Python 到 resources/python（发布打包前执行一次）
npm run dist               # 构建并打包 Windows NSIS 安装程序（输出到 dist/）
```

## 项目结构

```
Mathmodel-PI/
├── build/                      # 打包资源（应用图标等）
├── docs/                       # 项目文档
│   ├── architecture.md         # 架构设计（分层、数据流、关键决策）
│   ├── user-guide.md           # 用户手册
│   └── development.md          # 开发指南（环境、镜像、调试、发布流程）
├── resources/
│   ├── skills/                 # 内置数学建模工作流 Skills（mm-*）
│   └── python/                 # 便携 Python 运行时（fetch-python 生成，不入库）
├── scripts/
│   └── fetch-python.mjs        # 便携 Python 获取脚本
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── agent/              # pi 会话工厂、skills 注入、流水线执行器
│   │   ├── env.ts              # 本地环境检测（Python / XeLaTeX / pdftocairo）
│   │   ├── ipc.ts              # IPC 接口层
│   │   ├── projects.ts         # 项目（赛题工作区）管理
│   │   ├── protocol.ts         # mmfile:// 安全文件协议（预览用）
│   │   ├── providers.ts        # 模型服务商元信息
│   │   └── settings.ts         # 应用设置持久化
│   ├── preload/                # 预加载桥（contextBridge，类型化 API）
│   ├── renderer/               # 渲染进程（React 工作台 UI）
│   │   └── src/components/     # 顶栏 / 流水线条 / 执行流 / 预览区 / 模态框
│   └── shared/                 # 主/渲染进程共享类型与 API 契约
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

## 架构总览

```
┌────────────────────────── 渲染进程 (React) ──────────────────────────┐
│  顶栏 / 流水线阶段条 │ 执行流时间线 │ 产物预览（文件树 + 查看器）      │
└────────────△──────────────────────────────────────△──────────────────┘
             │ window.api (contextBridge)           │ pipeline:event 推送
┌────────────▽──────────────────────────────────────▽──────────────────┐
│                        主进程 (Electron Node)                        │
│  IPC 层 ── PipelineRunner（全自动/单步编排，manifest 状态同步）        │
│           ── Session 工厂（pi createAgentSession + Skills 注入       │
│              + ask_user 交互工具 + 多 provider API Key）             │
│  环境检测（Python/XeLaTeX）│ 项目管理 │ mmfile:// 协议 │ 设置存储     │
└────────────△──────────────────────────────────────△──────────────────┘
             │ bash / read / write / ask_user      │ LLM API
┌────────────▽──────────────┐          ┌──────────────▽────────────────┐
│   项目工作目录（产物权威） │          │   模型服务商（多 provider）    │
│   manifest / docs / code/  │          └───────────────────────────────┘
│   results/ figures/ paper/ │
└────────────────────────────┘
```

核心设计原则与取舍的完整说明见 [docs/architecture.md](docs/architecture.md)。

## 安全与隐私

- API Key 仅存储在本机用户数据目录（`%APPDATA%/Mathmodel-PI/settings.json`），不随任何请求发往模型服务商以外的地方。
- `mmfile://` 协议仅允许访问已登记的项目目录，防止任意文件读取。
- 执行流中智能体的全部文件操作限制在项目工作目录内（由 skills 的边界规则与 pi 工具沙箱共同约束）。

## Roadmap

- [ ] 会话持久化与断点续跑
- [ ] LaTeX 环境一键安装引导（内置 MiKTeX 离线包下载器）
- [ ] 执行成本与 Token 统计面板
- [ ] 多项目并行执行
- [ ] macOS / Linux 打包

## 贡献与许可

本项目以 [MIT](LICENSE) 协议开源，欢迎 Issue 与 PR。

内置数学建模工作流 Skills 来自 [MM_workflow](https://github.com/whlle-yi/MM_workflow)。
