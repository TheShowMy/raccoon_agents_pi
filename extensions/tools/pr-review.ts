import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost } from '../git-utils.js';
import { generateReviewReport, formatReviewFramework, formatDiffForReview } from '../code-review.js';
import { ok, fail, currentBranch } from './common.js';

export function registerPrReviewTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_pr_review',
        label: '审核 PR/MR',
        description:
            '获取当前分支对应 PR/MR 的详情（标题、描述、Diff、CI 状态），供 Agent 审核代码。支持 GitHub、GitLab。',
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const branch = await currentBranch(pi, cwd);
            if (!branch) {
                return fail('无法获取当前分支名。');
            }

            const { host } = await detectGitHost(pi, cwd);

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

                interface GhPr {
                    number: number;
                    title: string;
                    body: string;
                    state: string;
                    url: string;
                    headRefName: string;
                    baseRefName: string;
                    statusCheckRollup?: Array<{ name: string; status: string; conclusion: string }>;
                }

                let prs: GhPr[];
                try {
                    prs = JSON.parse(prListResult.stdout);
                } catch {
                    return fail('解析 PR 列表失败。');
                }

                if (prs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 PR。请先用 raccoon_pr_create 创建 PR。`);
                }

                const pr = prs[0];
                const lines: string[] = [];
                lines.push(`## PR #${pr.number}: ${pr.title}`);
                lines.push(`- 状态: ${pr.state}`);
                lines.push(`- 分支: ${pr.headRefName} → ${pr.baseRefName}`);
                lines.push(`- URL: ${pr.url}`);
                if (pr.body) {
                    lines.push('');
                    lines.push('### 描述');
                    lines.push(pr.body);
                }

                if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
                    lines.push('');
                    lines.push('### CI 检查');
                    for (const check of pr.statusCheckRollup) {
                        const icon =
                            check.conclusion === 'SUCCESS' ? '✅' :
                            check.conclusion === 'FAILURE' ? '❌' :
                            check.conclusion === 'NEUTRAL' ? '⚪' : '⏳';
                        lines.push(`- ${icon} ${check.name}: ${check.status}${check.conclusion ? ` (${check.conclusion})` : ''}`);
                    }
                } else {
                    lines.push('');
                    lines.push('### CI 检查');
                    lines.push('- 无 CI 检查数据');
                }

                const diffResult = await pi.exec(
                    'gh',
                    ['pr', 'diff', String(pr.number)],
                    { cwd, timeout: 15_000 },
                );

                if (diffResult.code === 0 && diffResult.stdout.trim()) {
                    const report = generateReviewReport(diffResult.stdout);
                    lines.push(formatReviewFramework(report));
                    lines.push('');
                    lines.push('### Diff（代码供审核参考）');
                    lines.push(formatDiffForReview(diffResult.stdout, 300));
                }

                return ok(lines.join('\n'));
            }

            if (host === 'gitlab') {
                const mrListResult = await pi.exec(
                    'glab',
                    ['mr', 'list', '--source-branch', branch, '--state', 'opened', '--output', 'json'],
                    { cwd, timeout: 10_000 },
                );

                if (mrListResult.code !== 0) {
                    return fail(`查询 MR 失败：${mrListResult.stderr || mrListResult.stdout}`);
                }

                interface GlMr {
                    iid: number;
                    title: string;
                    description: string;
                    state: string;
                    web_url: string;
                    source_branch: string;
                    target_branch: string;
                    detailed_merge_status?: string;
                }

                let mrs: GlMr[];
                try {
                    mrs = JSON.parse(mrListResult.stdout);
                } catch {
                    return fail('解析 MR 列表失败。');
                }

                if (!Array.isArray(mrs) || mrs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 MR。请先用 raccoon_pr_create 创建 MR。`);
                }

                const mr = mrs[0];
                const lines: string[] = [];
                lines.push(`## MR !${mr.iid}: ${mr.title}`);
                lines.push(`- 状态: ${mr.state}`);
                lines.push(`- 分支: ${mr.source_branch} → ${mr.target_branch}`);
                lines.push(`- URL: ${mr.web_url}`);
                if (mr.detailed_merge_status) {
                    lines.push(`- 合并状态: ${mr.detailed_merge_status}`);
                }
                if (mr.description) {
                    lines.push('');
                    lines.push('### 描述');
                    lines.push(mr.description);
                }

                const diffResult = await pi.exec(
                    'glab',
                    ['mr', 'diff', String(mr.iid)],
                    { cwd, timeout: 15_000 },
                );

                if (diffResult.code === 0 && diffResult.stdout.trim()) {
                    const report = generateReviewReport(diffResult.stdout);
                    lines.push(formatReviewFramework(report));
                    lines.push('');
                    lines.push('### Diff（代码供审核参考）');
                    lines.push(formatDiffForReview(diffResult.stdout, 300));
                }

                return ok(lines.join('\n'));
            }

            if (host === 'gitee') {
                return fail(
                    '暂不支持通过工具自动获取 Gitee PR 详情。\n' +
                        '请前往 Gitee 网站手动查看 Pull Request。',
                );
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });
}
