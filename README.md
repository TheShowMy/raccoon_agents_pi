# 🦝 Raccoon Agents（浣熊特工队）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Pi Package](https://img.shields.io/badge/Pi-Package-blue)](https://pi.dev)
[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)

> 一个为 [Pi Coding Agent](https://pi.dev) 设计的开发工作流扩展，提供 Git 状态面板、多模型并行代码审核、任务自动路由和标准化开发流程工具，引导 Agent 按「需求理解 → 创建分支 → 实现代码 → 验证 → 提交 → 推送 → 创建 PR → 代码审核 → 合并」的规范流程工作。

```
      ██╗  ██╗ █████╗  ██████╗ ██████╗ ██████╗ ███╗   ██╗
      ██║  ██║██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║
      ███████║███████║██║     ██║     ██║   ██║██╔██╗ ██║
      ██╔══██║██╔══██║██║     ██║     ██║   ██║██║╚██╗██║
      ██║  ██║██║  ██║╚██████╗╚██████╗╚██████╔╝██║ ╚████║
      ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝
```

## 简介

**Raccoon Agents** 是 Pi Coding Agent 的一个扩展，核心目标是：**让 Agent 的开发工作流规范化、可视化、可自动化。**

它提供以下能力：

-   **🎨 个性化 UI** — 自定义标题、工作流进度条、Git 状态页脚，实时展示分支、变更数、上下文占用等信息
-   **🛠️ LLM 可调用的开发工具** — Agent 可直接调用创建分支、提交、推送、创建 PR、并行审核等操作
-   **🔍 多模型并行代码审核** — 3 个不同档位的模型在独立进程中并行审核代码，覆盖逻辑、安全、可维护性、测试等角度
-   **🎯 任务自动路由** — 按任务类型自动选择最低成本的模型档位执行，失败自动升级
-   **📋 工作流引导** — 自动向 system prompt 注入标准化开发流程，确保 Agent 按规范执行

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  需求理解   │ ──▶ │  创建分支   │ ──▶ │  实现代码   │ ──▶ │  创建 PR   │
│ (Project  │     │ (Feature   │     │ (read/edit/│     │ (Push +   │
│   Info)    │     │   New)     │     │  write)    │     │   PR)     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                                        │
       │                    ┌─────────────┐                      │
       │                    │ 代码审核     │                      │
       │                    │ (3 模型并行) │                      │
       │                    └─────────────┘                      │
       └────────────────────────────────────────────────────────┘
                              自动工作流引导
```

## 功能特性

### 1. 实时 Git 状态面板

扩展加载后，TUI 底部会显示实时刷新的 Git 状态栏：

```
Git main    clean    upstream origin/main        ~/projects/raccoon-agents
staged 0  unstaged 0  untracked 0  conflicts 0   raccoon-agents  anthropic/claude-sonnet-4  off  ctx 12%/200k
```

显示内容包括：

| 区域 | 信息 |
| ---- | ---- |
| 左上 | 当前分支名、干净/脏状态、与上游的领先/落后提交数 |
| 右上 | 当前工作目录路径 |
| 左下 | 暂存区 / 未暂存 / 未跟踪 / 冲突文件数量 |
| 右下 | 项目名称、当前模型、思考层级、上下文占用率 |

> 状态在每次工具执行结束和对话轮次结束时自动刷新。

### 2. 工作流可视化

编辑器上下方显示工作流可视化组件：

- **进度条（上方）**：当前阶段名称 + 分段进度条（━ done, ▶━ current, ┄ pending）
- **并行任务面板（下方）**：运行中的任务列表，含状态图标和耗时

### 3. Agent 开发工作流工具

注册了 **16 个** LLM 可调用的工具，Agent 可在对话中直接调用：

| 工具 | 说明 |
| ---- | ---- |
| `raccoon_project_info` | 展示项目概览：Git 分支、状态、未推送提交、package.json 信息 |
| `raccoon_feature_new` | 基于 `main` 创建 feature 分支（自动加 `feat/` 前缀），自动检查工作区是否干净 |
| `raccoon_git_commit` | 暂存变更并提交，支持 conventional commits 格式，可指定暂存文件。**禁止在 main/master 上提交** |
| `raccoon_git_push` | 推送当前分支到 origin，自动设置 upstream，禁止直接推 main |
| `raccoon_run_test` | 自动检测并运行测试脚本（vitest/jest/mocha/tape），支持超时和信号取消 |
| `raccoon_pr_create` | 创建 Pull Request / Merge Request，自动检测平台（GitHub `gh` / GitLab `glab`） |
| `raccoon_pr_review` | 获取 PR 详情并启动**多模型并行审核**（3 个 subagent 独立进程），支持 `parallel: false` 简化审核 |
| `raccoon_pr_merge` | 合并 PR/MR（默认 squash），**强制要求先完成审核**，支持 `skipReview: true` 极小改动跳过 |
| `raccoon_issue_create` | 创建 Git Issue，支持标题、描述和标签，自动适配平台 |
| `raccoon_issue_list` | 列出最近的开放 Issue，支持按标签筛选 |
| `raccoon_issue_breakdown` | 读取 Issue 详情并提供任务拆分框架（前端/后端/测试/文档/部署），含模型档位推荐 |
| `raccoon_model_scan` | 扫描 Pi 中已配置的所有模型，显示未设档位的模型，生成批量设置命令 |
| `raccoon_model_config` | 设置/查看/删除模型档位（high/medium/low），默认 medium |
| `raccoon_model_list` | 列出所有模型档位配置（含已配置和未配置），按档位分组，用 `→` 标记当前模型 |
| `raccoon_clarify_select` | 需求澄清阶段的交互式方案选择器，方向键导航 + 回车确认 + 「自定义输入」选项 |
| `raccoon_task_route` | 按任务类型（test/docs/config/frontend/backend）自动路由到最低成本模型，失败自动 fallback 升级 |

### 4. 多模型并行代码审核

`raccoon_pr_review` 获取 PR diff 后，自动启动 **3 个独立的 pi 子进程**并行审核：

| 审核员 | 档位 | 审核角度 |
|--------|------|----------|
| 🔴 逻辑与安全审核员 | high | 逻辑正确性、安全漏洞、性能瓶颈 |
| 🟡 可维护性审核员 | medium | 代码风格、测试覆盖、兼容性 |
| 🟢 快速扫描员 | low | 拼写错误、语法问题、风格不一致 |

每个子 agent 运行在**完全隔离的上下文中**（通过 `PI_SUBAGENT_MODE` 环境变量防止递归加载 raccoon 扩展），使用不同档位的模型和独立的 system prompt。

**心跳超时机制**：基础周期 5 分钟，如果子 agent 仍有输出则自动延长（最多 2 次 = 最多 15 分钟），卡死进程立即 kill。

### 5. 模型档位与自动路由

支持为模型设置 **high（高档）/ medium（中档）/ low（低档）** 三档：

| 任务类型 | 推荐档位 | 说明 |
|---------|---------|------|
| 后端/API、架构设计 | 高档 | 推理能力强，处理复杂逻辑 |
| 前端/UI、文档 | 中档 | 代码生成或长文本能力 |
| 测试、配置/部署 | 低档 | 快速轻量，成本最优 |

**路由规则**：
- `raccoon_task_route` 按任务类型自动路由到最低成本档位，失败时自动 fallback 到更高档
- `raccoon_issue_breakdown` 自动按任务类型推荐档位
- 若推荐档位无配置模型，**自动 fallback 到更高档**

**管理命令**：
```
raccoon_model_scan                          # 扫描所有已配置模型，批量设置档位
raccoon_model_list                          # 查看所有模型档位（含已配置和未配置）
raccoon_model_config action=set model=xxx tier=high   # 设置档位
raccoon_model_config action=remove model=xxx          # 删除档位
```

### 6. 审核强制检查

`raccoon_pr_merge` 在合并前强制检查是否已完成代码审核（通过 workflow state 中的 `review` 步骤标记）。未审核直接拒绝合并，错误信息明确引导先调用 `raccoon_pr_review`。

极小改动（<50 行纯文档/配置）可通过 `skipReview: true` 显式跳过。

### 7. 交互式方案选择器

当需求存在多种实现方案时，`raccoon_clarify_select` 通过 TUI 展示选项供用户选择：

- 方向键 ↑↓ 导航选项
- 回车确认选择
- 选中「自定义方案」后切换为输入框自由输入
- Esc 随时取消

### 8. 工作流 Prompt 注入

在 Agent 启动前，自动向 system prompt 末尾追加标准化工作流说明，含 10 步流程 + 模型档位路由策略 + 禁止裸奔/直推 main/跳审等原则。

### 9. 非 Git 仓库自动提示

如果当前目录不是 Git 仓库，扩展会弹出确认对话框，引导用户初始化 Git 仓库后再进入对话。

## 安装

### 方式一：全局安装（推荐）

```bash
# 从 Git 安装
pi install git:github.com/<user>/raccoon-agents

# 从 npm 安装（若已发布）
pi install npm:raccoon-agents
```

### 方式二：克隆后本地运行（开发调试）

```bash
git clone <repo-url> raccoon-agents
cd raccoon-agents
npm install
```

启动方式：

```bash
# 使用本地启动入口
npm start

# 或手动指定扩展路径
pi -e .
```

### 方式三：项目级本地安装

```bash
cd /path/to/your-project
pi install -l /path/to/raccoon-agents
```

`-l` 会将扩展安装到当前项目的 `.pi/` 目录下。

### 验证安装

启动 Pi 后，若顶部出现浣熊 ASCII 艺术标题、底部出现 Git 状态栏，即表示扩展加载成功。

## 使用方式

启动扩展后，Agent 会自动遵循工作流。典型的功能开发对话如下：

```
用户：我想加一个用户登录功能
Agent：让我先查看一下项目状态……
      [调用 raccoon_project_info]
      好的，当前在 main 分支，工作区干净。
      我来创建 feature 分支并开始开发。
      [调用 raccoon_feature_new: {name: "user-login"}]
      ✅ 已创建并切换到分支 feat/user-login
      现在开始实现代码……
      [读取文件 → 编辑代码 → 写入文件]
      实现完成，运行类型检查……
      [运行 npm run typecheck]
      检查通过，提交代码。
      [调用 raccoon_git_commit + raccoon_git_push]
      创建 PR。
      [调用 raccoon_pr_create]
      ✅ PR 创建成功
      开始代码审核……
      [调用 raccoon_pr_review]
      🔍 多模型并行审核结果 (3/3 成功)
      ✅ 逻辑与安全审核员 → 通过
      ✅ 可维护性审核员 → 通过
      ✅ 快速扫描员 → 通过
      合并 PR。
      [调用 raccoon_pr_merge]
      ✅ PR 已合并，已切回 main
```

## 系统要求

-   [Pi Coding Agent](https://pi.dev) >= 0.77.0
-   [Node.js](https://nodejs.org/) >= 20
-   Git（必需，用于分支管理和状态展示）
-   [GitHub CLI](https://cli.github.com/) `gh`（可选，用于创建 PR / Issue）
-   [GitLab CLI](https://glab.readthedocs.io/) `glab`（可选，用于 GitLab MR / Issue）

> Gitee 暂不支持通过工具自动操作，会返回错误引导手动前往网站处理。

## 项目结构

```
raccoon-agents/
├── bin/
│   └── raccoon-pi.mjs              # 本地启动入口脚本（封装 pi -e）
├── extensions/
│   ├── index.ts                    # 扩展主入口：UI 安装、事件监听、工具注册、子 agent 隔离
│   ├── project-info.ts             # raccoon_project_info 工具实现
│   ├── git-workflow.ts             # 16 个工具的统一注册入口
│   ├── git-utils.ts                # Git 工具函数（状态解析、命令执行）
│   ├── model-tier.ts               # 模型档位配置与自动路由引擎
│   ├── code-review.ts              # 6 角度代码审核框架（逻辑/安全/性能/可维护性/测试/兼容）
│   ├── subagent.ts                 # 子 agent 引擎（并行执行、心跳超时、递归隔离）
│   ├── workflow-prompt.ts          # 工作流 system prompt 模板（10 步流程 + 原则）
│   ├── workflow-ui.ts              # 工作流可视化（进度条 + 并行任务面板）
│   ├── tools/                      # 14 个独立工具文件
│   │   ├── common.ts               # 共享：ok/fail/sanitizeOutput/currentBranch
│   │   ├── feature-new.ts          # raccoon_feature_new
│   │   ├── git-commit.ts           # raccoon_git_commit（main 分支保护）
│   │   ├── git-push.ts             # raccoon_git_push
│   │   ├── pr-create.ts            # raccoon_pr_create（GitHub + GitLab）
│   │   ├── pr-review.ts            # raccoon_pr_review（多模型并行审核）
│   │   ├── pr-merge.ts             # raccoon_pr_merge（审核强制检查）
│   │   ├── run-test.ts             # raccoon_run_test
│   │   ├── issue-create.ts         # raccoon_issue_create
│   │   ├── issue-list.ts           # raccoon_issue_list
│   │   ├── issue-breakdown.ts      # raccoon_issue_breakdown（任务拆分 + 模型推荐）
│   │   ├── model-scan.ts           # raccoon_model_scan
│   │   ├── model-config.ts         # raccoon_model_config
│   │   ├── model-list.ts           # raccoon_model_list
│   │   ├── clarify-select.ts       # raccoon_clarify_select（交互式选择器）
│   │   └── task-route.ts           # raccoon_task_route（任务路由 + 自动 fallback）
│   └── __tests__/                  # 单元测试（66 个测试）
│       ├── git-utils.test.ts       # Git 工具测试
│       ├── model-tier.test.ts      # 模型档位测试
│       ├── code-review.test.ts     # 审核框架测试
│       ├── subagent.test.ts        # 子 agent 测试
│       ├── task-route.test.ts      # 任务路由测试
│       └── workflow-ui.test.ts     # 工作流状态测试
├── .pre-commit-config.yaml         # Pre-commit 代码质量检查配置
├── .prettierrc                     # Prettier 代码格式化配置
├── package.json                    # Pi Package 配置
├── tsconfig.json                   # TypeScript 配置
├── LICENSE                         # MIT 开源许可证
├── CONTRIBUTING.md                 # 贡献指南
└── README.md                       # 本文件
```

## 开发

```bash
# 克隆仓库
git clone <repo-url> raccoon-agents
cd raccoon-agents

# 安装依赖
npm install

# 类型检查
npm run typecheck

# 运行测试
npm test

# 本地启动调试
npm start
```

## 路线图

-   [x] Git 状态实时面板
-   [x] 工作流进度条 + 并行任务面板
-   [x] 项目信息工具（`raccoon_project_info`）
-   [x] Feature 分支创建工具（`raccoon_feature_new`）
-   [x] Git 提交工具（`raccoon_git_commit`）+ main 分支保护
-   [x] Git 推送工具（`raccoon_git_push`）
-   [x] PR 创建工具（`raccoon_pr_create`）
-   [x] PR 审核工具（`raccoon_pr_review`）+ 多模型并行审核
-   [x] PR 合并工具（`raccoon_pr_merge`）+ 审核强制检查
-   [x] 自动测试运行（`raccoon_run_test`）
-   [x] 工作流 prompt 自动注入
-   [x] 支持多种 Git 托管平台（GitHub `gh` / GitLab `glab`）
-   [x] 需求 → Issue 自动转换（`raccoon_issue_create` / `raccoon_issue_list`）
-   [x] Issue 智能任务拆分（`raccoon_issue_breakdown`）
-   [x] 模型档位管理（`raccoon_model_config` / `raccoon_model_list` / `raccoon_model_scan`）
-   [x] 多模型任务路由与自动 fallback（`raccoon_task_route`）
-   [x] 交互式方案选择器（`raccoon_clarify_select`）
-   [x] 子 agent 递归隔离（`PI_SUBAGENT_MODE`）
-   [x] 心跳超时机制（5 分钟活动检测 + 自动延长）

## 作为 Pi Package 分发

1. **通过 npm 发布**：
    - 确保 `package.json` 中包含 `"keywords": ["pi-package"]`
    - 执行 `npm publish`
    - 用户通过 `pi install npm:<package-name>` 安装

2. **通过 Git 发布**：
    - 将代码推送到公开 Git 仓库
    - 用户通过 `pi install git:github.com/<user>/<repo>` 安装
    - 可附加 `@<tag>` 或 `@<commit>` 指定版本

3. **通过 URL 安装**：
    ```bash
    pi install https://github.com/<user>/<repo>
    ```

## 开源协议

本项目采用 [MIT 许可证](./LICENSE) 开源。

```
MIT License

Copyright (c) 2026 Raccoon Agents Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## 贡献指南

我们欢迎所有形式的贡献！请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解如何参与：

-   🐛 提交 Bug 报告
-   💡 提出功能建议
-   🔧 提交代码改进
-   📝 完善文档

## 社区与支持

-   📦 [Pi Coding Agent](https://pi.dev) — 本扩展的运行平台
-   💬 遇到问题？请在 GitHub Issues 中讨论

---

<p align="center">
  Built with ❤️ for <a href="https://pi.dev">Pi Coding Agent</a>
</p>
