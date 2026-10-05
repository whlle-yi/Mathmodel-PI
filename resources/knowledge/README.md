# 内置知识库（源文件目录）

这里是随软件分发的**知识素材**。与 `resources/skills/`（行为指令）分工明确：

- skills（8 个 mm-*）是**工作流专属的行为指令**——只在工作流视图装配，整读执行；
- 本目录的内容是知识本体——对话模式经检索引用（builtin.sqlite3），工作流阶段
  按 SKILL.md 指示经相对路径（`../../knowledge/...`）**整读**对应文件。

## 内容清单

| 位置 | 内容 | 来源 |
| --- | --- | --- |
| `methods/` | 算法目录、选型矩阵、选型场景库、题型分类、字典判合指南、**选型决策树**、**API 编码防错手册** | 自 mm-modeling / mm-problem-analysis / mm-model-dictionary 迁移 + 新写 |
| `writing/` | 论文总规则、语言与故事线、篇幅控制、6 本写作 playbook、AI 使用声明规范、10 个章节模板 | 自 mm-paper-writing / mm-verification 迁移 |
| `competition/` | 竞赛规范、评审视角（待补充） | — |
| `examples/` | 精选案例片段（待补充） | — |

每个文件开头有**路由头**：标注主要使用方（哪个工作流 skill 的哪个步骤），
工作流按它整读，对话按它检索。

## 如何补充知识

1. 把 markdown 放进对应目录（或新建主题目录）；
2. 文件开头加路由头（说明主要使用方与用途）；
3. `npm run build-kb` 重建索引；
4. 重新打包生效。

## 排除与边界

- `manifest.json` 只索引本目录；skills 里剩下的全是规则文件（SKILL.md、
  writing-order.json、机检脚本），走整读通道，绝不切块；
- 模型字典 `mm-model-dictionary/assets/model-dictionary.json` 是结构化数据，
  走专用查询脚本（query_model_dictionary.py），不入检索索引。
