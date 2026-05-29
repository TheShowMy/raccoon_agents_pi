# Contributing to Raccoon Agents

感谢你对浣熊特工队的兴趣！我们欢迎所有形式的贡献，包括 bug 报告、功能建议、代码提交和文档改进。

## 如何贡献

### 报告问题

如果你发现了 bug 或有功能建议，请通过 [GitHub Issues](https://github.com/<user>/raccoon-agents/issues) 提交。提交时请包含：

- 清晰的问题描述
- 复现步骤（如果是 bug）
- 预期行为与实际行为
- 运行环境（Pi 版本、Node.js 版本、操作系统）

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

- 使用 TypeScript，保持类型安全
- 遵循项目中现有的代码风格
- 为新增功能添加必要的注释说明
- 确保 `npm run typecheck` 无错误

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
