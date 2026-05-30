/**
 * Git 工作流工具 — 注册 13 个 LLM 可调用工具
 *
 * 所有工具已拆分到 extensions/tools/ 目录，
 * 本文件作为入口统一注册。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerFeatureNewTool } from './tools/feature-new.js';
import { registerGitCommitTool } from './tools/git-commit.js';
import { registerGitPushTool } from './tools/git-push.js';
import { registerPrCreateTool } from './tools/pr-create.js';
import { registerPrReviewTool } from './tools/pr-review.js';
import { registerRunTestTool } from './tools/run-test.js';
import { registerPrMergeTool } from './tools/pr-merge.js';
import { registerIssueCreateTool } from './tools/issue-create.js';
import { registerIssueListTool } from './tools/issue-list.js';
import { registerIssueBreakdownTool } from './tools/issue-breakdown.js';
import { registerModelScanTool } from './tools/model-scan.js';
import { registerModelConfigTool } from './tools/model-config.js';
import { registerModelListTool } from './tools/model-list.js';
import { registerClarifySelectTool } from './tools/clarify-select.js';
import { registerTaskRouteTool } from './tools/task-route.js';

export function registerGitWorkflowTools(pi: ExtensionAPI): void {
    registerFeatureNewTool(pi);
    registerGitCommitTool(pi);
    registerGitPushTool(pi);
    registerPrCreateTool(pi);
    registerPrReviewTool(pi);
    registerRunTestTool(pi);
    registerPrMergeTool(pi);
    registerIssueCreateTool(pi);
    registerIssueListTool(pi);
    registerIssueBreakdownTool(pi);
    registerModelScanTool(pi);
    registerModelConfigTool(pi);
    registerModelListTool(pi);
    registerClarifySelectTool(pi);
    registerTaskRouteTool(pi);
}
