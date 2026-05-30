/**
 * Raccoon Agents 开发工作流 Prompt
 *
 * 在 before_agent_start 时注入到 system prompt 末尾，
 * 引导 Agent 按标准流程工作。
 */

export const WORKFLOW_SYSTEM_PROMPT = [
    "## Raccoon Agents 开发工作流",
    "",
    "当用户请求功能开发时，遵循以下流程：",
    "",
    "1. 需求理解 — 用 raccoon_project_info 了解当前项目状态，确认需求范围",
    "2. 创建分支 — 用 raccoon_feature_new 创建 feat/<功能名> 分支",
    "3. 实现代码 — 使用 read/write/edit 修改文件",
    "4. 验证 — 运行 npm run typecheck 确保编译通过",
    "5. 提交 — 用 raccoon_git_commit 提交变更（conventional commits 格式）",
    "6. 推送 — 用 raccoon_git_push 推送分支",
    "7. 创建 PR — 用 raccoon_pr_create 创建 Pull Request",
    "",
    "重要原则：",
    "- 每次提交前必须运行 npm run typecheck",
    "- 提交消息使用 conventional commits（feat:/fix:/refactor:/docs:/chore:）",
    "- 分支命名：feat/<功能名>（如 feat/add-git-tools）",
    "- 禁止在未完成 typecheck 前提交",
].join("\n");
