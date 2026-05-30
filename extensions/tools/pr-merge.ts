import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost, gitExec } from '../git-utils.js';
import { getWorkflowState } from '../workflow-ui.js';
import { ok, fail, currentBranch } from './common.js';

export function registerPrMergeTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_pr_merge',
        label: '合并 PR/MR',
        description:
            '合并当前分支对应的 PR/MR。要求 CI 全部通过且无冲突，支持 merge/squash/rebase。支持 GitHub、GitLab。',
        parameters: Type.Object({
            method: Type.Optional(
                Type.Union(
                    [Type.Literal('merge'), Type.Literal('squash'), Type.Literal('rebase')],
                    { description: '合并方式，默认 squash' },
                ),
            ),
            skipReview: Type.Optional(
                Type.Boolean({
                    description: '是否跳过代码审核（极小改动时可用，默认 false）',
                    default: false,
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const method = params.method ?? 'squash';
            const skipReview = params.skipReview ?? false;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            // 审核强制检查：未审核且未明确跳过，则拒绝合并
            if (!skipReview) {
                const state = getWorkflowState();
                if (!state.completedSteps.has('review')) {
                    return fail(
                        '❌ 禁止跳审！\n\n' +
                        '合并前必须先调用 `raccoon_pr_review` 审核代码。\n' +
                        '如果本次改动极小（<50 行纯文档/配置），' +
                        '可在调用 `raccoon_pr_merge` 时设置 `skipReview: true` 明确跳过。',
                    );
                }
            }

            const branch = await currentBranch(pi, cwd);
            if (!branch) {
                return fail('无法获取当前分支名。');
            }

            const { host } = await detectGitHost(pi, cwd);

            if (host === 'github') {
                const prListResult = await pi.exec(
                    'gh',
                    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,title,statusCheckRollup'],
                    { cwd, timeout: 10_000 },
                );

                if (prListResult.code !== 0) {
                    return fail(`查询 PR 失败：${prListResult.stderr || prListResult.stdout}`);
                }

                interface MergePr {
                    number: number;
                    title: string;
                    statusCheckRollup?: Array<{ name: string; conclusion: string }>;
                }

                let prs: MergePr[];
                try {
                    prs = JSON.parse(prListResult.stdout);
                } catch {
                    return fail('解析 PR 列表失败。');
                }

                if (prs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 PR。`);
                }

                const pr = prs[0];

                if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
                    const failures = pr.statusCheckRollup.filter(c => c.conclusion === 'FAILURE');
                    const pending = pr.statusCheckRollup.filter(
                        c => !c.conclusion || c.conclusion === 'PENDING' || c.conclusion === 'IN_PROGRESS',
                    );

                    if (failures.length > 0) {
                        return fail(`CI 未通过：${failures.map(c => c.name).join(', ')}。`);
                    }
                    if (pending.length > 0) {
                        return fail(`CI 进行中：${pending.map(c => c.name).join(', ')}。等待完成。`);
                    }
                }

                const mergeStatus = await pi.exec(
                    'gh',
                    ['pr', 'view', String(pr.number), '--json', 'mergeable,mergeStateStatus'],
                    { cwd, timeout: 10_000 },
                );

                if (mergeStatus.code === 0) {
                    try {
                        const ms = JSON.parse(mergeStatus.stdout);
                        if (ms.mergeable === 'CONFLICTING') {
                            return fail('PR 存在合并冲突，请先在本地解决冲突。');
                        }
                        if (ms.mergeStateStatus === 'BLOCKED') {
                            return fail('PR 被阻止合并（可能缺少审核或 CI 未通过）。');
                        }
                    } catch { /* ignore */ }
                }

                const mergeArgs = ['pr', 'merge', String(pr.number), `--${method}`];
                if (method === 'squash') mergeArgs.push('--subject', pr.title);
                mergeArgs.push('--delete-branch');

                const mergeResult = await pi.exec('gh', mergeArgs, { cwd, timeout: 15_000 });

                if (mergeResult.code !== 0) {
                    return fail(`合并失败：${mergeResult.stderr || mergeResult.stdout}`);
                }

                return cleanupAfterMerge(pi, cwd, branch, 'PR', pr.number, method, mergeResult.stdout.trim());
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

                interface GlMergeMr {
                    iid: number;
                    title: string;
                    detailed_merge_status?: string;
                    head_pipeline?: { status: string };
                }

                let mrs: GlMergeMr[];
                try {
                    mrs = JSON.parse(mrListResult.stdout);
                } catch {
                    return fail('解析 MR 列表失败。');
                }

                if (!Array.isArray(mrs) || mrs.length === 0) {
                    return fail(`分支 ${branch} 没有打开的 MR。`);
                }

                const mr = mrs[0];

                if (mr.detailed_merge_status) {
                    const blocking = ['checking', 'unchecked'];
                    if (!blocking.includes(mr.detailed_merge_status)) {
                        if (mr.detailed_merge_status.includes('conflict')) {
                            return fail('MR 存在合并冲突，请先在本地解决冲突。');
                        }
                        if (mr.detailed_merge_status !== 'mergeable') {
                            return fail(`MR 当前不可合并：${mr.detailed_merge_status}。`);
                        }
                    }
                }

                if (mr.head_pipeline && mr.head_pipeline.status) {
                    const status = mr.head_pipeline.status.toLowerCase();
                    if (status === 'failed' || status === 'canceled') {
                        return fail(`CI 未通过（pipeline ${mr.head_pipeline.status}）。`);
                    }
                    if (status !== 'success' && status !== 'skipped') {
                        return fail(`CI 进行中（pipeline ${mr.head_pipeline.status}）。请等待完成。`);
                    }
                }

                const squashFlag = method === 'squash' ? '--squash' : '';
                const mergeCmd = squashFlag
                    ? ['mr', 'merge', String(mr.iid), '--squash', '--yes']
                    : ['mr', 'merge', String(mr.iid), `--${method}`, '--yes'];

                const mergeResult = await pi.exec('glab', mergeCmd, { cwd, timeout: 15_000 });

                if (mergeResult.code !== 0) {
                    return fail(`合并失败：${mergeResult.stderr || mergeResult.stdout}`);
                }

                return cleanupAfterMerge(pi, cwd, branch, 'MR', mr.iid, method, mergeResult.stdout.trim());
            }

            if (host === 'gitee') {
                return fail(
                    '暂不支持通过工具自动合并 Gitee PR。\n' +
                        '请前往 Gitee 网站手动合并 Pull Request。',
                );
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });
}

async function cleanupAfterMerge(
    pi: ExtensionAPI,
    cwd: string,
    branch: string,
    type: 'PR' | 'MR',
    id: number,
    method: string,
    mergeOutput: string,
) {
    const checkoutMain = await gitExec(pi, ['checkout', 'main'], cwd);
    if (checkoutMain.code !== 0) {
        return ok(
            `✅ ${type} !${id} 已合并（${method}）\n${mergeOutput}\n\n` +
                `⚠️ 本地清理失败：无法切回 main（${checkoutMain.stderr || checkoutMain.stdout}）。请手动执行。`,
        );
    }

    const deleteLocal = await gitExec(pi, ['branch', '-d', branch], cwd);
    const pullResult = await gitExec(pi, ['pull'], cwd, 30_000);

    const lines: string[] = [];
    lines.push(`✅ ${type} !${id} 已合并（${method}）`);
    lines.push(mergeOutput);
    lines.push('');
    lines.push('🏠 已切回 main 分支');
    if (deleteLocal.code === 0) {
        lines.push(`🗑️ 已删除本地分支 ${branch}`);
    } else {
        lines.push(`⚠️ 本地分支 ${branch} 删除失败：${deleteLocal.stderr || deleteLocal.stdout}`);
    }
    if (pullResult.code === 0) {
        lines.push('⬇️ 已拉取最新 main');
    } else {
        lines.push(`⚠️ git pull 失败：${pullResult.stderr || pullResult.stdout}`);
    }

    return ok(lines.join('\n'));
}
