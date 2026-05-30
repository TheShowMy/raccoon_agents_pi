/**
 * Raccoon Agents 开发工作流 Prompt
 *
 * 在 before_agent_start 时注入到 system prompt 末尾，
 * 引导 Agent 按标准流程工作。
 */

export const WORKFLOW_SYSTEM_PROMPT = [
    "## Raccoon Agents 开发工作流",
    "",
    "当用户请求功能开发时，严格遵循以下流程。每一步完成后才能进入下一步。",
    "",
    "### 1. 需求澄清（MUST 先执行，禁止直接编码）",
    "",
    "需求不明确时，主动向用户确认以下内容后才开始编码：",
    "- 功能目标：这个功能要解决什么问题？",
    "- 范围边界：具体改哪些文件/模块？不碰哪些？",
    "- 验收标准：什么算「完成」？",
    "- 技术约束：有指定的库、API、命名规范吗？",
    "",
    "确认完成后，用 raccoon_project_info 了解当前项目状态，",
    "然后向用户总结你的理解和执行计划，等待用户确认再动手。",
    "需求已经明确（如用户给了详细的 spec、plan、issue 链接）时可以精简，",
    "但 MUST 至少用 1-2 句话复述你的理解让用户确认。",
    "",
    "### 2. 创建 Issue（可选）— 如需求需要跟踪，用 raccoon_issue_create 创建 Issue",    "### 3. 创建分支 — 用 raccoon_feature_new 创建 feat/<功能名> 分支",
    "### 4. 实现代码 — 使用 read/write/edit 修改文件",
    "### 5. 验证 — 先运行 npm run typecheck 确保编译通过，再运行 raccoon_run_test 确保测试通过",
    "### 6. 提交 — 用 raccoon_git_commit 提交变更（conventional commits 格式）",
    "### 7. 推送 — 用 raccoon_git_push 推送分支",
    "### 8. 创建 PR — 用 raccoon_pr_create 创建 Pull Request",
    "### 9. 代码审核 — 用 raccoon_pr_review 获取 PR Diff，检查代码质量、逻辑正确性、边界条件",
    "### 10. 合并 PR — 审核通过且 CI 全绿后，用 raccoon_pr_merge 合并（默认 squash）",
    "",
    "重要原则：",
    "- 跳过步骤 1 直接编码是严重违规。即使是简单改动也要复述理解",
    "- 每次提交前必须先运行 npm run typecheck，再运行 raccoon_run_test（如有测试脚本）",
    "- 提交消息使用 conventional commits（feat:/fix:/refactor:/docs:/chore:）",
    "- 分支命名：feat/<功能名>（如 feat/add-git-tools）",
    "- 禁止在未完成 typecheck 和测试前提交",
    "- 合并前必须确认 CI 全绿且无冲突，禁止跳过审核直接合并",
].join("\n");
