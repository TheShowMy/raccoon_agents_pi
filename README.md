# 🦝 Raccoon Agents（浣熊特工队）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Pi Package](https://img.shields.io/badge/Pi-Package-blue)](https://pi.dev)
[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)

> 一个为 [Pi Coding Agent](https://pi.dev) 设计的开发工作流扩展，提供 Git 状态面板和标准化开发流程工具，引导 Agent 按「需求理解 → 创建分支 → 实现代码 → 验证 → 提交 → 推送 → 创建 PR」的规范流程工作。

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

-   **🎨 个性化 UI** — 自定义标题与 Git 状态页脚，实时展示分支、变更数、上下文占用等信息
-   **🛠️ LLM 可调用的开发工具** — Agent 可直接调用创建分支、提交、推送、创建 PR 等操作
-   **📋 工作流引导** — 自动向 system prompt 注入标准化开发流程，确保 Agent 按规范执行

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  需求理解   │ ──▶ │  创建分支   │ ──▶ │  实现代码   │ ──▶ │   提交 PR   │
│ (Project  │     │ (Feature   │     │ (read/edit/│     │ (Commit +  │
│   Info)    │     │   New)     │     │  write)    │     │   Push +  │
│            │     │            │     │            │     │   PR)     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                                        │
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

### 2. Agent 开发工作流工具

注册了 5 个 LLM 可调用的工具，Agent 可在对话中直接调用：

| 工具 | 说明 |
| ---- | ---- |
| `raccoon_project_info` | 展示项目概览：Git 分支、状态、未推送提交、package.json 信息 |
| `raccoon_feature_new` | 基于 `main` 创建 feature 分支（自动加 `feat/` 前缀），自动检查工作区是否干净 |
| `raccoon_git_commit` | 暂存变更并提交，支持 conventional commits 格式，可指定暂存文件 |
| `raccoon_git_push` | 推送当前分支到 origin，自动设置 upstream，禁止直接推 main |
| `raccoon_issue_create` | 创建 Git Issue，支持标题、描述和标签，自动适配平台 |
| `raccoon_issue_list` | 列出最近的开放 Issue，支持按标签筛选 |
| `raccoon_pr_create` | 创建 Pull Request / Merge Request，自动检测平台（GitHub `gh` / GitLab `glab`） |

### 3. 工作流 Prompt 注入

在 Agent 启动前，自动向 system prompt 末尾追加标准化工作流说明：

```
1. 需求理解 — 用 raccoon_project_info 了解项目状态
2. 创建分支 — 用 raccoon_feature_new 创建 feat/<功能名> 分支
3. 实现代码 — 使用 read/write/edit 修改文件
4. 验证 — 运行 npm run typecheck 确保编译通过
5. 提交 — 用 raccoon_git_commit 提交（conventional commits）
6. 推送 — 用 raccoon_git_push 推送分支
7. 创建 PR — 用 raccoon_pr_create 创建 PR
```

### 4. 非 Git 仓库自动提示

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
```

## 系统要求

-   [Pi Coding Agent](https://pi.dev) >= 0.77.0
-   [Node.js](https://nodejs.org/) >= 20
-   Git（必需，用于分支管理和状态展示）
-   [GitHub CLI](https://cli.github.com/) `gh`（可选，用于创建 PR）

## 项目结构

```
raccoon-agents/
├── bin/
│   └── raccoon-pi.mjs          # 本地启动入口脚本（封装 pi -e）
├── extensions/
│   ├── index.ts                # 扩展主入口：UI 安装、事件监听、工具注册
│   ├── project-info.ts         # raccoon_project_info 工具实现
│   ├── git-workflow.ts         # 4 个 Git 工作流工具实现
│   ├── git-utils.ts            # Git 工具函数（状态解析、命令执行）
│   └── workflow-prompt.ts      # 工作流 system prompt 模板
├── .pre-commit-config.yaml     # Pre-commit 代码质量检查配置
├── .prettierrc                 # Prettier 代码格式化配置
├── package.json                # Pi Package 配置
├── tsconfig.json               # TypeScript 配置
├── LICENSE                     # MIT 开源许可证
├── CONTRIBUTING.md             # 贡献指南
└── README.md                   # 本文件
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

# 本地启动调试
npm start
```

## 路线图

-   [x] Git 状态实时面板
-   [x] 项目信息工具（`raccoon_project_info`）
-   [x] Feature 分支创建工具（`raccoon_feature_new`）
-   [x] Git 提交工具（`raccoon_git_commit`）
-   [x] Git 推送工具（`raccoon_git_push`）
-   [x] PR 创建工具（`raccoon_pr_create`）
-   [x] 工作流 prompt 自动注入
-   [ ] 自动测试运行与质量门禁
-   [ ] PR 自动合并
-   [x] 支持多种 Git 托管平台（GitLab `glab` / Gitee 提示）
-   [x] 需求 → Issue 自动转换（`raccoon_issue_create` / `raccoon_issue_list`）
-   [ ] Issue 智能任务拆分
-   [ ] 多模型任务分配与并行编排

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
