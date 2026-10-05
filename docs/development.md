# 开发指南

## 1. 环境准备

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22 | 开发与构建 |
| npm | ≥ 10 | |
| Electron 二进制 | 随依赖安装 | 见下述镜像说明 |
| （可选）MiKTeX / TeX Live | 本机安装 | 联调论文编译链路 |

### Electron 二进制下载

npm 项目级 `.npmrc` 中的镜像键已不被新版 npm 支持，请使用环境变量：

```bash
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install

# 若依赖已装好但二进制缺失
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; node node_modules/electron/install.js
```

可执行文件/脚本方式（Git Bash）：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

## 2. 常用命令

```bash
npm run dev          # 开发模式（主进程热重载 + 渲染进程 HMR）
npm run typecheck    # node 端 + web 端 TypeScript 检查
npm run build        # 构建三端产物到 out/
npm run dist         # 打包 Windows NSIS 安装程序到 dist/
npm run dist:dir     # 仅打未压缩目录包（快速验证）
npm run fetch-python # 下载便携 Python 到 resources/python（打包前执行）
```

## 3. 开发约定

### 分层与依赖方向

```
shared ← main →（实现）shared/api
shared ← preload（实现）shared/api
shared ← renderer（消费）window.api: Api
```

- 渲染进程禁止直接 `require` Node 模块；一切能力经 `src/shared/api.ts` 契约暴露。
- 跨进程数据结构只放 `src/shared/types.ts`，主/渲染两端不得各自另写一份。

### 代码风格

- TypeScript strict；主进程 ESM（`"type": "module"`）。
- 中文注释，注释说明「约束与原因」，不复述代码。

### 打包注意

- `resources/skills` 经 `electron-builder.yml` 的 `extraResources` 复制到安装目录 `resources/skills`，运行时由 `bundledSkillsDir()` 定位。
- `resources/python` 不入库（.gitignore），发布前执行 `npm run fetch-python`。
- `asarUnpack` 覆盖 `resources/**` 与 `@earendil-works/**`，避免 asar 内路径解析问题。

## 4. 调试

- 主进程：`npm run dev` 时 `console.log` 直接输出到启动终端；或用 VS Code 附加 Electron 主进程。
- 渲染进程：应用窗口内 `Ctrl+Shift+I` 打开 DevTools。
- 流水线事件：主进程 `PipelineRunner` 的 emit 是事件总源头，可在此打断点观察事件流。
- 无 GUI 冒烟测试（Node 环境）：

```bash
node --input-type=module -e "
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
const { skills, diagnostics } = await loadSkillsFromDir({ dir: 'resources/skills', source: 'builtin' });
console.log(skills.map(s => s.name), diagnostics);
"
```

## 5. 发布流程

1. 更新 `package.json` 版本号（semver）。
2. `npm run fetch-python` 确保 `resources/python` 就绪。
3. `npm run typecheck && npm run build` 全绿。
4. `npm run dist:dir` 冒烟：运行 `dist/win-unpacked/Mathmodel-PI.exe` 走一遍引导与项目创建。
5. `npm run dist` 产出 NSIS 安装包，人工验收后打 tag 并发布。
6. 将安装包与更新说明挂到 GitHub Release。

## 6. Skills 版本管理

内置 skills 取自 [MM_workflow](https://github.com/whlle-yi/MM_workflow) 的日期快照目录（当前为 `2026.9.3`），复制其下 `mm-*` 到 `resources/skills/`（剔除 `__pycache__`）。更新流程：

1. 下载新版 MM_workflow 快照；
2. 整体替换 `resources/skills/mm-*`；
3. 跑 §4 的冒烟测试确认 0 diagnostics；
4. 在 `docs/architecture.md` 与 Release 说明中登记版本来源。
