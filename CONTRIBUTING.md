# Contributing to Raccoon Agents

感谢你对浣熊特工队的兴趣！我们欢迎所有形式的贡献，包括 bug 报告、功能建议、代码提交和文档改进。

## 如何贡献

### 报告问题

如果你发现了 bug 或有功能建议，请通过 [GitHub Issues](https://github.com/<user>/raccoon-agents/issues) 提交。提交时请包含：

-   清晰的问题描述
-   复现步骤（如果是 bug）
-   预期行为与实际行为
-   运行环境（Pi 版本、Node.js 版本、操作系统）

### 提交代码

1. **Fork 仓库** 到你自己的 GitHub 账号
2. **克隆你的 Fork**
    ```bash
    git clone https://github.com/<your-username>/raccoon-agents.git
    cd raccoon-agents
    ```
3. **创建功能分支**
    ```bash
    git checkout -b feat/your-feature-name
    ```
4. **进行更改** 并确保通过类型检查
    ```bash
    npm run typecheck
    ```
5. **提交更改**
    ```bash
    git add .
    git commit -m "feat: 简短描述"
    ```
    提交信息请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
    - `feat:` 新功能
    - `fix:` 修复 bug
    - `docs:` 文档更新
    - `refactor:` 代码重构
    - `chore:` 构建/工具变动
6. **推送到你的 Fork**
    ```bash
    git push origin feat/your-feature-name
    ```
7. **发起 Pull Request** 到主仓库

### 代码规范

-   使用 TypeScript，保持类型安全
-   遵循项目中现有的代码风格
-   为新增功能添加必要的注释说明
-   确保 `npm run typecheck` 无错误

## Pre-commit 代码质量检查

本项目使用 [pre-commit](https://pre-commit.com/) 在代码提交阶段自动运行质量检查，防止不符合规范的代码进入仓库。

### 安装 pre-commit

你需要先安装 `pre-commit` 工具（要求 Python >= 3.9）：

```bash
pip install pre-commit
```

如果你使用 `pipx` 或系统包管理器，也可以：

```bash
# macOS
brew install pre-commit

# pipx（推荐）
pipx install pre-commit
```

### 启用 Git Hooks（推荐：全局自动启用）

推荐使用 `init-templatedir` 方式，让**所有新克隆的仓库自动拥有 pre-commit hooks**，无需在每个仓库中手动运行 `pre-commit install`：

```bash
# 1. 设置 Git 全局模板目录
git config --global init.templateDir ~/.git-template

# 2. 将 pre-commit hook 安装到模板目录
pre-commit init-templatedir ~/.git-template
```

设置完成后，以后克隆任何已配置 `.pre-commit-config.yaml` 的仓库时，hooks 会自动生效。对于**已经克隆的旧仓库**，仍需手动执行一次：

```bash
pre-commit install
```

> 💡 `init-templatedir` 使用 `--allow-missing-config` 选项，没有 `.pre-commit-config.yaml` 的仓库会被自动跳过，不会影响正常提交。

#### 传统方式（单仓库手动启用）

如果你不想全局设置，也可以只针对当前仓库启用：

```bash
pre-commit install
```

### 配置说明

`.pre-commit-config.yaml` 中配置了以下检查：

| Hook                | 说明                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| 去除行尾多余空格    | 自动删除每行末尾的多余空格（`.md` 文件除外）                                        |
| 修复文件末尾换行    | 确保每个文件末尾有且只有一个换行符                                                  |
| 检查 JSON 语法      | 校验 JSON 文件格式是否正确                                                          |
| 检查大文件提交      | 禁止提交超过 500KB 的大文件                                                         |
| 统一换行符为 LF     | 将所有文件的换行符统一为 LF 格式                                                    |
| 检查合并冲突标记    | 检查代码中是否残留 `<<<<<<<` / `=======` / `>>>>>>>` 等合并冲突标记                 |
| 代码格式化          | 使用 Prettier 自动格式化代码，统一代码风格（支持 TS / JS / JSON / YAML / Markdown） |
| TypeScript 类型检查 | 运行 `npm run typecheck`，对全项目进行类型检查                                      |

### 手动运行检查

如果你想在提交前手动检查所有文件：

```bash
# 检查所有文件
pre-commit run --all-files

# 只检查特定 hook
pre-commit run typecheck --all-files
```

### 跳过检查（紧急情况）

如遇紧急情况需要跳过 pre-commit 检查：

```bash
git commit -m "..." --no-verify
```

> ⚠️ **不建议常规使用**。跳过检查可能导致不符合规范的代码进入仓库，请在 CI 或后续提交中修复问题。

## 开发环境

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 本地运行调试
npm start
```

## 行为准则

参与本项目即表示你同意以尊重、包容和友善的态度对待所有贡献者。任何形式的骚扰、歧视或不尊重行为都是不可接受的。

## 许可证

通过向本项目提交代码，你同意你的贡献将在 [MIT 许可证](./LICENSE) 下发布。
