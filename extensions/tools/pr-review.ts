import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost } from '../git-utils.js';
import { generateReviewReport, formatReviewFramework, formatDiffForReview } from '../code-review.js';
import { runParallelReview, createReviewAgents, formatParallelReviewReport } from '../subagent.js';
import { addParallelTask, finishParallelTask } from '../workflow-ui.js';
import { ok, fail, currentBranch } from './common.js';

export function registerPrReviewTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_pr_review',
        label: '审核 PR/MR',
        description:
            '获取当前分支对应 PR/MR 的详情（标题、描述、Diff、CI 状态），并启动多模型并行审核。支持 GitHub、GitLab。',
        parameters: Type.Object({
            parallel: Type.Optional(
                Type.Boolean({
                    description: '是否启动多模型并行审核（默认 true）',
                    default: true,
                }),
            ),
        }),
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const branch = await currentBranch(pi, cwd);
            if (!branch) {
                return fail('无法获取当前分支名。');
            }

            const { host } = await detectGitHost(pi, cwd);

            let prInfo: string[] = [];
            let diffContent: string | null = null;

            if (host === 'github') {
                const prListResult = await pi.exec(
                    'gh',
                    [
                        'pr', 'list', '--head', branch, '--state', 'open', '--json',
                        'number,title,body,state,url,headRefName,baseRefName,statusCheckRollup',
                    ],
                    { cwd, timeout: 10_000 },
                );

                if (prListResult.code !== 0) {
                    return fail(`查询 PR 失败：${prListResult.stderr || prListResult.stdout}`);
                }

                let prs: Array<{
                    number: number;
                    title: string;
                    body: string;
                    state: string;
                    url: string;
                    headRefName: string;
                    baseRefName: string;
                    statusCheckRollup?: Array<{ name: string; status: string; conclusion: string }>;
                }>;
                try {
                    prs = JSON.parse(prListResult.stdout);
                } catch {
                    return fail('解析 PR 列表失败。');
                }

                if (prs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 PR。请先用 raccoon_pr_create 创建 PR。`);
                }

                const pr = prs[0];
                prInfo.push(`## PR #${pr.number}: ${pr.title}`);
                prInfo.push(`- 状态: ${pr.state}`);
                prInfo.push(`- 分支: ${pr.headRefName} → ${pr.baseRefName}`);
                prInfo.push(`- URL: ${pr.url}`);
                if (pr.body) {
                    prInfo.push('');
                    prInfo.push('### 描述');
                    prInfo.push(pr.body);
                }

                if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
                    prInfo.push('');
                    prInfo.push('### CI 检查');
                    for (const check of pr.statusCheckRollup) {
                        const icon =
                            check.conclusion === 'SUCCESS' ? '✅' :
                            check.conclusion === 'FAILURE' ? '❌' :
                            check.conclusion === 'NEUTRAL' ? '⚪' : '⏳';
                        prInfo.push(`- ${icon} ${check.name}: ${check.status}${check.conclusion ? ` (${check.conclusion})` : ''}`);
                    }
                } else {
                    prInfo.push('');
                    prInfo.push('### CI 检查');
                    prInfo.push('- 无 CI 检查数据');
                }

                const diffResult = await pi.exec(
                    'gh',
                    ['pr', 'diff', String(pr.number)],
                    { cwd, timeout: 15_000 },
                );

                if (diffResult.code === 0 && diffResult.stdout.trim()) {
                    diffContent = diffResult.stdout;
                }
            } else if (host === 'gitlab') {
                const mrListResult = await pi.exec(
                    'glab',
                    ['mr', 'list', '--source-branch', branch, '--state', 'opened', '--output', 'json'],
                    { cwd, timeout: 10_000 },
                );

                if (mrListResult.code !== 0) {
                    return fail(`查询 MR 失败：${mrListResult.stderr || mrListResult.stdout}`);
                }

                let mrs: Array<{
                    iid: number;
                    title: string;
                    description: string;
                    state: string;
                    web_url: string;
                    source_branch: string;
                    target_branch: string;
                    detailed_merge_status?: string;
                }>;
                try {
                    mrs = JSON.parse(mrListResult.stdout);
                } catch {
                    return fail('解析 MR 列表失败。');
                }

                if (!Array.isArray(mrs) || mrs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 MR。请先用 raccoon_pr_create 创建 MR。`);
                }

                const mr = mrs[0];
                prInfo.push(`## MR !${mr.iid}: ${mr.title}`);
                prInfo.push(`- 状态: ${mr.state}`);
                prInfo.push(`- 分支: ${mr.source_branch} → ${mr.target_branch}`);
                prInfo.push(`- URL: ${mr.web_url}`);
                if (mr.detailed_merge_status) {
                    prInfo.push(`- 合并状态: ${mr.detailed_merge_status}`);
                }
                if (mr.description) {
                    prInfo.push('');
                    prInfo.push('### 描述');
                    prInfo.push(mr.description);
                }

                const diffResult = await pi.exec(
                    'glab',
                    ['mr', 'diff', String(mr.iid)],
                    { cwd, timeout: 15_000 },
                );

                if (diffResult.code === 0 && diffResult.stdout.trim()) {
                    diffContent = diffResult.stdout;
                }
            } else if (host === 'gitee') {
                return fail(
                    '暂不支持通过工具自动获取 Gitee PR 详情。\n' +
                        '请前往 Gitee 网站手动查看 Pull Request。',
                );
            } else {
                return fail(
                    `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                        '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
                );
            }

            // 构建返回内容
            const lines: string[] = [...prInfo];

            if (diffContent) {
                // 1. 自动分析 diff
                const report = generateReviewReport(diffContent);
                lines.push(formatReviewFramework(report));
                lines.push('');

                // 2. 多模型并行审核（如果启用）
                const enableParallel = params.parallel !== false;
                if (enableParallel) {
                    const agents = createReviewAgents();
                    const agentList = [agents.logicAgent, agents.maintainAgent, agents.scanAgent].filter(
                        (a) => a.model, // 只使用有模型配置的 agent
                    );

                    if (agentList.length >= 2) {
                        lines.push('⏳ 正在启动多模型并行审核...');
                        lines.push('');

                        const taskIds = new Map<string, string>();
                        const reviewResult = await runParallelReview(cwd, agentList, diffContent, {
                            signal,
                            heartbeatMs: 300_000,
                            maxHeartbeats: 2,
                            onUpdate: (agentName, chunk) => {
                                if (onUpdate) {
                                    onUpdate({
                                        content: [{ type: 'text' as const, text: `🔍 ${agentName} 审核中...\n${chunk.slice(0, 500)}` }],
                                        details: {},
                                    });
                                }
                            },
                            onTaskStart: (agentName) => {
                                taskIds.set(agentName, addParallelTask(agentName, 'review'));
                            },
                            onTaskEnd: (agentName, success) => {
                                const id = taskIds.get(agentName);
                                if (id) finishParallelTask(id, success);
                            },
                        });
                        lines.push(formatParallelReviewReport(reviewResult));
                        lines.push('');
                    } else {
                        lines.push('⚠️ 并行审核需要至少 2 个档位有模型配置，当前不满足。');
                        lines.push('请用 `raccoon_model_scan` 和 `raccoon_model_config` 配置各档位模型。');
                        lines.push('');
                    }
                }

                // 3. Diff 参考
                lines.push('### Diff（代码供审核参考）');
                lines.push(formatDiffForReview(diffContent, 300));
            }

            return ok(lines.join('\n'));
        },
    });
}
