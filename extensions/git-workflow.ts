/**
 * Git 工作流工具 — 注册 12 个 LLM 可调用工具，
 * 提供安全的、带校验的分支管理、提交、推送、PR 创建、审核、合并、测试运行、Issue 管理与拆分、模型档位配置与路由全流程。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { gitExec, isGitWorkTree, readGitStatus, detectGitHost, type GitHost } from './git-utils.js';
import {
    loadTierConfig,
    saveTierConfig,
    getModelTier,
    setModelTier,
    removeModelTier,
    getModelsByTier,
    routeModel,
    recommendModelForTask,
    type ModelTier,
} from './model-tier.js';

// ── 辅助函数 ──────────────────────────────────────────────

/** 获取当前分支名，失败返回 null */
async function currentBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
    const r = await gitExec(pi, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (r.code !== 0) return null;
    return r.stdout.trim();
}

function ok(text: string) {
    return { content: [{ type: 'text' as const, text }], details: {} };
}

function fail(text: string) {
    return { content: [{ type: 'text' as const, text: `❌ ${text}` }], details: {} };
}

// ── 注册入口 ──────────────────────────────────────────────

export function registerGitWorkflowTools(pi: ExtensionAPI): void {
    // ════════════════════════════════════════════════════════
    // 1. raccoon_feature_new
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_feature_new',
        label: '新建功能分支',
        description: '基于 main 创建 feature 分支。自动添加 feat/ 前缀。',
        parameters: Type.Object({
            name: Type.String({ description: '功能短名（自动加 feat/ 前缀）' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。请先 git init 或切换到 Git 项目。');
            }

            const status = await readGitStatus(pi, cwd);
            if (status.staged + status.unstaged > 0) {
                return fail(
                    `工作区有未提交的变更（暂存 ${status.staged} / 未暂存 ${status.unstaged}）。\n` +
                        '请先提交或暂存 (git stash) 后再创建分支。',
                );
            }

            const branch = `feat/${params.name}`;

            const checkoutMain = await gitExec(pi, ['checkout', 'main'], cwd);
            if (checkoutMain.code !== 0) {
                return fail(`无法切换到 main 分支：${checkoutMain.stderr || checkoutMain.stdout}`);
            }

            const create = await gitExec(pi, ['checkout', '-b', branch], cwd);
            if (create.code !== 0) {
                await gitExec(pi, ['checkout', '-'], cwd);
                return fail(`创建分支 ${branch} 失败：${create.stderr || create.stdout}`);
            }

            return ok(`✅ 已创建并切换到分支 ${branch}\n工作区干净，可以开始开发。`);
        },
    });

    // ════════════════════════════════════════════════════════
    // 2. raccoon_git_commit
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_git_commit',
        label: 'Git 提交',
        description: '暂存变更并提交。支持 conventional commits 格式。',
        parameters: Type.Object({
            message: Type.String({ description: '提交消息（feat:/fix:/refactor:/docs:/chore:）' }),
            files: Type.Optional(
                Type.Array(Type.String(), { description: '要暂存的文件（可选，不指定则 git add -A）' }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const addArgs =
                params.files && params.files.length > 0 ? ['add', ...params.files] : ['add', '-A'];
            const addResult = await gitExec(pi, addArgs, cwd);
            if (addResult.code !== 0) {
                return fail(`git add 失败：${addResult.stderr || addResult.stdout}`);
            }

            const diffResult = await gitExec(pi, ['diff', '--cached', '--quiet'], cwd);
            if (diffResult.code === 0) {
                return fail('暂存区为空，没有需要提交的变更。');
            }

            const commitResult = await gitExec(pi, ['commit', '-m', params.message], cwd);
            if (commitResult.code !== 0) {
                return fail(`git commit 失败：${commitResult.stderr || commitResult.stdout}`);
            }

            const hashResult = await gitExec(pi, ['rev-parse', '--short', 'HEAD'], cwd);
            const hash = hashResult.code === 0 ? hashResult.stdout.trim() : 'HEAD';

            return ok(`✅ 提交成功 ${hash}\n消息: ${params.message}`);
        },
    });

    // ════════════════════════════════════════════════════════
    // 3. raccoon_git_push
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_git_push',
        label: 'Git 推送',
        description: '推送当前分支到 origin。自动设置 upstream 跟踪。',
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
            if (branch === 'main' || branch === 'master') {
                return fail('当前在 main/master 分支，不允许直接推送。请先创建 feature 分支。');
            }

            const remoteResult = await gitExec(pi, ['remote'], cwd);
            if (remoteResult.code !== 0 || !remoteResult.stdout.trim()) {
                return fail('没有配置 remote 仓库。请先执行 git remote add origin <url>。');
            }

            const pushResult = await gitExec(
                pi,
                ['push', '--set-upstream', 'origin', branch],
                cwd,
                30_000,
            );

            if (pushResult.code !== 0) {
                return fail(`推送失败：${pushResult.stderr || pushResult.stdout}`);
            }

            return ok(`✅ 推送成功\n\`${branch} → origin/${branch}\``);
        },
    });

    // ════════════════════════════════════════════════════════
    // 4. raccoon_pr_create
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_pr_create',
        label: '创建 PR/MR',
        description: '创建 Pull Request / Merge Request。支持 GitHub (gh)、GitLab (glab)。',
        parameters: Type.Object({
            title: Type.String({ description: 'PR/MR 标题' }),
            body: Type.Optional(Type.String({ description: 'PR/MR 描述（可选）' })),
            base: Type.Optional(Type.String({ description: '目标分支，默认 main' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const branch = await currentBranch(pi, cwd);
            if (!branch) {
                return fail('无法获取当前分支名。');
            }

            const base = params.base ?? 'main';
            const { host } = await detectGitHost(pi, cwd);

            const remoteCheck = await gitExec(pi, ['rev-parse', '--verify', `origin/${branch}`], cwd);
            if (remoteCheck.code !== 0) {
                return fail(
                    `远程分支 origin/${branch} 不存在。\n请先用 raccoon_git_push 推送分支后再创建 PR/MR。`,
                );
            }

            if (host === 'github') {
                const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
                if (ghCheck.code !== 0) {
                    return fail(
                        '未检测到 gh CLI。\n' +
                            '安装：brew install gh（macOS）或 https://cli.github.com/\n' +
                            '安装后需登录：gh auth login',
                    );
                }

                const prArgs = ['pr', 'create', '--head', branch, '--base', base, '--title', params.title];
                if (params.body) {
                    prArgs.push('--body', params.body);
                }

                const prResult = await pi.exec('gh', prArgs, { cwd, timeout: 15_000 });
                if (prResult.code !== 0) {
                    return fail(`创建 PR 失败：${prResult.stderr || prResult.stdout}`);
                }
                return ok(`✅ PR 创建成功\n${prResult.stdout.trim()}`);
            }

            if (host === 'gitlab') {
                const glabCheck = await pi.exec('glab', ['--version'], { cwd, timeout: 3_000 });
                if (glabCheck.code !== 0) {
                    return fail(
                        '未检测到 glab CLI。\n' +
                            '安装：brew install glab（macOS）或 https://glab.readthedocs.io/\n' +
                            '安装后需登录：glab auth login',
                    );
                }

                const mrArgs = [
                    'mr', 'create',
                    '--source-branch', branch,
                    '--target-branch', base,
                    '--title', params.title,
                ];
                if (params.body) {
                    mrArgs.push('--description', params.body);
                }

                const mrResult = await pi.exec('glab', mrArgs, { cwd, timeout: 15_000 });
                if (mrResult.code !== 0) {
                    return fail(`创建 MR 失败：${mrResult.stderr || mrResult.stdout}`);
                }
                return ok(`✅ MR 创建成功\n${mrResult.stdout.trim()}`);
            }

            if (host === 'gitee') {
                return fail(
                    '暂不支持通过工具自动创建 Gitee PR。\n' +
                        '请前往 Gitee 网站手动创建 Pull Request。',
                );
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });

    // ════════════════════════════════════════════════════════
    // 5. raccoon_pr_review
    // ════════════════════════════════════════════════════════

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
                    const diffLines = diffResult.stdout.split('\n');
                    if (diffLines.length > 300) {
                        lines.push('');
                        lines.push(`### Diff（前 300 行，共 ${diffLines.length} 行）`);
                        lines.push('```diff');
                        lines.push(diffLines.slice(0, 300).join('\n'));
                        lines.push('```');
                        lines.push(`（省略 ${diffLines.length - 300} 行）`);
                    } else {
                        lines.push('');
                        lines.push(`### Diff（${diffLines.length} 行）`);
                        lines.push('```diff');
                        lines.push(diffResult.stdout);
                        lines.push('```');
                    }
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
                    const diffLines = diffResult.stdout.split('\n');
                    if (diffLines.length > 300) {
                        lines.push('');
                        lines.push(`### Diff（前 300 行，共 ${diffLines.length} 行）`);
                        lines.push('```diff');
                        lines.push(diffLines.slice(0, 300).join('\n'));
                        lines.push('```');
                        lines.push(`（省略 ${diffLines.length - 300} 行）`);
                    } else {
                        lines.push('');
                        lines.push(`### Diff（${diffLines.length} 行）`);
                        lines.push('```diff');
                        lines.push(diffResult.stdout);
                        lines.push('```');
                    }
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

    // ════════════════════════════════════════════════════════
    // 6. raccoon_run_test
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_run_test',
        label: '运行测试',
        description:
            '运行项目测试脚本。自动检测 package.json 中的测试命令，也可手动指定脚本名。',
        parameters: Type.Object({
            script: Type.Optional(
                Type.String({
                    description:
                        '要运行的测试脚本名（如 test, test:unit），不指定则自动检测',
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const pkgPath = join(cwd, 'package.json');

            if (!existsSync(pkgPath)) {
                return fail('当前目录没有 package.json，无法检测测试脚本。');
            }

            let pkg: { scripts?: Record<string, string> };
            try {
                pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            } catch {
                return fail('解析 package.json 失败。');
            }

            const scripts = pkg.scripts ?? {};
            const testScriptNames = Object.keys(scripts).filter(
                (k) =>
                    k === 'test' ||
                    k.startsWith('test:') ||
                    k.startsWith('test-') ||
                    k.endsWith(':test'),
            );

            let scriptName = params.script;
            if (!scriptName) {
                if (testScriptNames.length === 0) {
                    return fail(
                        'package.json 中没有检测到测试脚本（test / test:*）。\n' +
                            '如需运行其他脚本，请通过 script 参数指定。',
                    );
                }
                scriptName = testScriptNames.includes('test')
                    ? 'test'
                    : testScriptNames[0];
            }

            if (!scripts[scriptName]) {
                return fail(
                    `package.json 中不存在脚本 "${scriptName}"。\n可用脚本: ${Object.keys(scripts).join(', ')}`,
                );
            }

            const execResult = await pi.exec(
                'npm',
                ['run', scriptName, '--'],
                { cwd, timeout: 60_000 },
            );

            const output = execResult.stdout.trim();
            const errorOutput = execResult.stderr.trim();

            if (execResult.code === 0) {
                return ok(
                    `✅ 测试通过 \`npm run ${scriptName}\`\n\n${output}${errorOutput ? '\n\nstderr:\n' + errorOutput : ''}`,
                );
            }

            return fail(
                `测试失败（退出码 ${execResult.code}）\`npm run ${scriptName}\`\n\n${output}${errorOutput ? '\n\nstderr:\n' + errorOutput : ''}`,
            );
        },
    });

    // ════════════════════════════════════════════════════════
    // 7. raccoon_pr_merge
    // ════════════════════════════════════════════════════════

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
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const method = params.method ?? 'squash';

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

                // 检查 CI
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

                // 检查合并状态
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
                    } catch { /* ignore parse errors */ }
                }

                const mergeArgs = ['pr', 'merge', String(pr.number), `--${method}`];
                if (method === 'squash') mergeArgs.push('--subject', pr.title);
                mergeArgs.push('--delete-branch');

                const mergeResult = await pi.exec('gh', mergeArgs, { cwd, timeout: 15_000 });

                if (mergeResult.code !== 0) {
                    return fail(`合并失败：${mergeResult.stderr || mergeResult.stdout}`);
                }

                // 合并后清理本地工作区
                const checkoutMain = await gitExec(pi, ['checkout', 'main'], cwd);
                if (checkoutMain.code !== 0) {
                    return ok(
                        `✅ PR #${pr.number} 已合并（${method}）\n${mergeResult.stdout.trim()}\n\n` +
                            `⚠️ 本地清理失败：无法切回 main（${checkoutMain.stderr || checkoutMain.stdout}）。请手动执行。`,
                    );
                }

                const deleteLocal = await gitExec(pi, ['branch', '-d', branch], cwd);
                const pullResult = await gitExec(pi, ['pull'], cwd, 30_000);

                const cleanupLines: string[] = [];
                cleanupLines.push(`✅ PR #${pr.number} 已合并（${method}）`);
                cleanupLines.push(mergeResult.stdout.trim());
                cleanupLines.push('');
                cleanupLines.push('🏠 已切回 main 分支');
                if (deleteLocal.code === 0) {
                    cleanupLines.push(`🗑️ 已删除本地分支 ${branch}`);
                } else {
                    cleanupLines.push(
                        `⚠️ 本地分支 ${branch} 删除失败：${deleteLocal.stderr || deleteLocal.stdout}`,
                    );
                }
                if (pullResult.code === 0) {
                    cleanupLines.push('⬇️ 已拉取最新 main');
                } else {
                    cleanupLines.push(
                        `⚠️ git pull 失败：${pullResult.stderr || pullResult.stdout}`,
                    );
                }

                return ok(cleanupLines.join('\n'));
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

                // 检查合并状态
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

                // 检查 CI
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

                // 合并后清理本地工作区
                const checkoutMain = await gitExec(pi, ['checkout', 'main'], cwd);
                if (checkoutMain.code !== 0) {
                    return ok(
                        `✅ MR !${mr.iid} 已合并（${method}）\n${mergeResult.stdout.trim()}\n\n` +
                            `⚠️ 本地清理失败：无法切回 main（${checkoutMain.stderr || checkoutMain.stdout}）。请手动执行。`,
                    );
                }

                const deleteLocal = await gitExec(pi, ['branch', '-d', branch], cwd);
                const pullResult = await gitExec(pi, ['pull'], cwd, 30_000);

                const cleanupLines: string[] = [];
                cleanupLines.push(`✅ MR !${mr.iid} 已合并（${method}）`);
                cleanupLines.push(mergeResult.stdout.trim());
                cleanupLines.push('');
                cleanupLines.push('🏠 已切回 main 分支');
                if (deleteLocal.code === 0) {
                    cleanupLines.push(`🗑️ 已删除本地分支 ${branch}`);
                } else {
                    cleanupLines.push(
                        `⚠️ 本地分支 ${branch} 删除失败：${deleteLocal.stderr || deleteLocal.stdout}`,
                    );
                }
                if (pullResult.code === 0) {
                    cleanupLines.push('⬇️ 已拉取最新 main');
                } else {
                    cleanupLines.push(
                        `⚠️ git pull 失败：${pullResult.stderr || pullResult.stdout}`,
                    );
                }

                return ok(cleanupLines.join('\n'));
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

    // ════════════════════════════════════════════════════════
    // 8. raccoon_issue_create
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_issue_create',
        label: '创建 Issue',
        description: '创建 Git Issue。支持 GitHub (gh)、GitLab (glab)。',
        parameters: Type.Object({
            title: Type.String({ description: 'Issue 标题' }),
            body: Type.String({ description: 'Issue 描述' }),
            labels: Type.Optional(
                Type.Array(Type.String(), { description: '标签列表（可选）' }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const { host } = await detectGitHost(pi, cwd);

            if (host === 'github') {
                const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
                if (ghCheck.code !== 0) {
                    return fail(
                        '未检测到 gh CLI。\n' +
                            '安装：brew install gh（macOS）或 https://cli.github.com/\n' +
                            '安装后需登录：gh auth login',
                    );
                }

                const args = ['issue', 'create', '--title', params.title, '--body', params.body];
                if (params.labels && params.labels.length > 0) {
                    for (const label of params.labels) {
                        args.push('--label', label);
                    }
                }

                const result = await pi.exec('gh', args, { cwd, timeout: 15_000 });
                if (result.code !== 0) {
                    return fail(`创建 Issue 失败：${result.stderr || result.stdout}`);
                }
                return ok(`✅ Issue 创建成功\n${result.stdout.trim()}`);
            }

            if (host === 'gitlab') {
                const glabCheck = await pi.exec('glab', ['--version'], { cwd, timeout: 3_000 });
                if (glabCheck.code !== 0) {
                    return fail(
                        '未检测到 glab CLI。\n' +
                            '安装：brew install glab（macOS）或 https://glab.readthedocs.io/\n' +
                            '安装后需登录：glab auth login',
                    );
                }

                const args = ['issue', 'create', '--title', params.title, '--description', params.body];
                if (params.labels && params.labels.length > 0) {
                    for (const label of params.labels) {
                        args.push('--label', label);
                    }
                }

                const result = await pi.exec('glab', args, { cwd, timeout: 15_000 });
                if (result.code !== 0) {
                    return fail(`创建 Issue 失败：${result.stderr || result.stdout}`);
                }
                return ok(`✅ Issue 创建成功\n${result.stdout.trim()}`);
            }

            if (host === 'gitee') {
                return fail(
                    '暂不支持通过工具自动创建 Gitee Issue。\n' +
                        '请前往 Gitee 网站手动创建 Issue。',
                );
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });

    // ════════════════════════════════════════════════════════
    // 9. raccoon_issue_list
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_issue_list',
        label: 'Issue 列表',
        description: '列出最近的开放 Issue。支持 GitHub (gh)、GitLab (glab)。',
        parameters: Type.Object({
            limit: Type.Optional(
                Type.Number({ description: '返回数量，默认 10' }),
            ),
            label: Type.Optional(
                Type.String({ description: '按标签筛选（可选）' }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const limit = params.limit ?? 10;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const { host } = await detectGitHost(pi, cwd);

            if (host === 'github') {
                const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
                if (ghCheck.code !== 0) {
                    return fail('未检测到 gh CLI。');
                }

                const args = ['issue', 'list', '--state', 'open', '--limit', String(limit), '--json', 'number,title,labels,url'];
                if (params.label) {
                    args.push('--label', params.label);
                }

                const result = await pi.exec('gh', args, { cwd, timeout: 10_000 });
                if (result.code !== 0) {
                    return fail(`查询 Issue 失败：${result.stderr || result.stdout}`);
                }

                interface GhIssue {
                    number: number;
                    title: string;
                    labels: Array<{ name: string }>;
                    url: string;
                }

                let issues: GhIssue[];
                try {
                    issues = JSON.parse(result.stdout);
                } catch {
                    return fail('解析 Issue 列表失败。');
                }

                if (issues.length === 0) {
                    return ok('📭 当前没有开放的 Issue。');
                }

                const lines: string[] = [];
                lines.push(`## 开放 Issue（共 ${issues.length} 条）`);
                for (const issue of issues) {
                    const labels = issue.labels.map(l => l.name).join(', ');
                    lines.push(`- #${issue.number} ${issue.title}${labels ? ` [${labels}]` : ''}`);
                    lines.push(`  ${issue.url}`);
                }
                return ok(lines.join('\n'));
            }

            if (host === 'gitlab') {
                const glabCheck = await pi.exec('glab', ['--version'], { cwd, timeout: 3_000 });
                if (glabCheck.code !== 0) {
                    return fail('未检测到 glab CLI。');
                }

                const args = ['issue', 'list', '--state', 'opened', '--per-page', String(limit), '--output', 'json'];
                if (params.label) {
                    args.push('--label', params.label);
                }

                const result = await pi.exec('glab', args, { cwd, timeout: 10_000 });
                if (result.code !== 0) {
                    return fail(`查询 Issue 失败：${result.stderr || result.stdout}`);
                }

                interface GlIssue {
                    iid: number;
                    title: string;
                    labels: string[];
                    web_url: string;
                }

                let issues: GlIssue[];
                try {
                    issues = JSON.parse(result.stdout);
                } catch {
                    return fail('解析 Issue 列表失败。');
                }

                if (!Array.isArray(issues) || issues.length === 0) {
                    return ok('📭 当前没有开放的 Issue。');
                }

                const lines: string[] = [];
                lines.push(`## 开放 Issue（共 ${issues.length} 条）`);
                for (const issue of issues) {
                    const labels = issue.labels?.join(', ') ?? '';
                    lines.push(`- #${issue.iid} ${issue.title}${labels ? ` [${labels}]` : ''}`);
                    lines.push(`  ${issue.web_url}`);
                }
                return ok(lines.join('\n'));
            }

            if (host === 'gitee') {
                return fail('暂不支持通过工具查询 Gitee Issue。');
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });

    // ════════════════════════════════════════════════════════
    // 10. raccoon_issue_breakdown
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_issue_breakdown',
        label: 'Issue 拆分',
        description:
            '读取 Issue 详情并提供任务拆分框架，帮助 Agent 将需求拆分为可执行的子任务。支持 GitHub、GitLab。',
        parameters: Type.Object({
            issue: Type.Union(
                [
                    Type.Number({ description: 'Issue 编号' }),
                    Type.String({ description: 'Issue 标题关键词（用于搜索）' }),
                ],
                { description: 'Issue 编号或关键词' },
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const { host } = await detectGitHost(pi, cwd);

            if (host === 'github') {
                const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
                if (ghCheck.code !== 0) {
                    return fail('未检测到 gh CLI。');
                }

                let issueNumber: number;
                if (typeof params.issue === 'number') {
                    issueNumber = params.issue;
                } else {
                    // 搜索 Issue
                    const searchResult = await pi.exec(
                        'gh',
                        ['issue', 'list', '--search', params.issue, '--state', 'open', '--limit', '5', '--json', 'number,title'],
                        { cwd, timeout: 10_000 },
                    );
                    if (searchResult.code !== 0) {
                        return fail(`搜索 Issue 失败：${searchResult.stderr || searchResult.stdout}`);
                    }

                    interface SearchIssue {
                        number: number;
                        title: string;
                    }

                    let issues: SearchIssue[];
                    try {
                        issues = JSON.parse(searchResult.stdout);
                    } catch {
                        return fail('解析搜索结果失败。');
                    }

                    if (issues.length === 0) {
                        return fail(`未找到包含 "${params.issue}" 的开放 Issue。`);
                    }
                    if (issues.length > 1) {
                        return fail(
                            `找到多个匹配 Issue，请使用编号指定：\n` +
                                issues.map(i => `- #${i.number}: ${i.title}`).join('\n'),
                        );
                    }
                    issueNumber = issues[0].number;
                }

                const viewResult = await pi.exec(
                    'gh',
                    ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state,url'],
                    { cwd, timeout: 10_000 },
                );

                if (viewResult.code !== 0) {
                    return fail(`读取 Issue 失败：${viewResult.stderr || viewResult.stdout}`);
                }

                interface GhIssueDetail {
                    number: number;
                    title: string;
                    body: string;
                    labels: Array<{ name: string }>;
                    state: string;
                    url: string;
                }

                let detail: GhIssueDetail;
                try {
                    detail = JSON.parse(viewResult.stdout);
                } catch {
                    return fail('解析 Issue 详情失败。');
                }

                const labels = detail.labels.map(l => l.name).join(', ');
                const lines: string[] = [];
                lines.push(`## Issue #${detail.number}: ${detail.title}`);
                lines.push(`- 状态: ${detail.state}`);
                lines.push(`- 标签: ${labels || '无'}`);
                lines.push(`- URL: ${detail.url}`);
                lines.push('');
                lines.push('### 描述');
                lines.push(detail.body || '（无描述）');
                lines.push('');
                lines.push('---');

                // 模型档位自动路由
                const tierConfig = loadTierConfig();
                const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
                const currentTier = currentModelId ? getModelTier(tierConfig, currentModelId) : null;

                lines.push('### 建议的任务拆分框架');
                lines.push('根据 Issue 内容，可按以下维度拆分子任务：');
                lines.push('');

                const taskDimensions = [
                    { key: 'frontend', name: '前端/UI', desc: '页面组件、交互逻辑、样式调整' },
                    { key: 'backend', name: '后端/API', desc: '接口设计、数据模型、业务逻辑' },
                    { key: 'test', name: '测试', desc: '单元测试、集成测试、E2E 测试' },
                    { key: 'docs', name: '文档', desc: 'README、API 文档、CHANGELOG' },
                    { key: 'config', name: '配置/部署', desc: 'CI/CD、环境变量、依赖升级' },
                ];

                for (const dim of taskDimensions) {
                    const { recommendedTier, routedTier, models, fallback } = recommendModelForTask(
                        tierConfig,
                        dim.key,
                    );
                    const tierLabel =
                        routedTier === 'high' ? '高档' : routedTier === 'medium' ? '中档' : '低档';
                    const recLabel =
                        recommendedTier === 'high'
                            ? '高档'
                            : recommendedTier === 'medium'
                              ? '中档'
                              : '低档';
                    const fallbackNote = fallback ? `（${recLabel}无模型，自动升至${tierLabel}）` : '';
                    const modelList = models.slice(0, 3).join(' / ');
                    const moreModels = models.length > 3 ? ` 等 ${models.length} 个` : '';

                    lines.push(
                        `1. **${dim.name}** — ${dim.desc} ${fallbackNote}`,
                    );
                    lines.push(`   - 推荐档位：${recLabel} → 实际路由：${tierLabel}`);
                    lines.push(`   - 可用模型：${modelList}${moreModels}`);
                    if (currentTier && currentTier !== routedTier) {
                        lines.push(
                            `   - ⚠️ 当前模型档位（${currentTier === 'high' ? '高档' : currentTier === 'medium' ? '中档' : '低档'}）与推荐档位不匹配，建议切换到 ${modelList.split(' / ')[0] ?? '对应档位模型'}`,
                        );
                    }
                }

                lines.push('');
                lines.push('请结合 Issue 描述，判断哪些维度涉及本次需求，逐一实现。');
                lines.push('');
                lines.push('> 💡 用 `raccoon_model_config action=get` 查看/修改模型档位配置。');

                return ok(lines.join('\n'));
            }

            if (host === 'gitlab') {
                const glabCheck = await pi.exec('glab', ['--version'], { cwd, timeout: 3_000 });
                if (glabCheck.code !== 0) {
                    return fail('未检测到 glab CLI。');
                }

                let issueIid: number;
                if (typeof params.issue === 'number') {
                    issueIid = params.issue;
                } else {
                    const searchResult = await pi.exec(
                        'glab',
                        ['issue', 'list', '--search', params.issue, '--state', 'opened', '--per-page', '5', '--output', 'json'],
                        { cwd, timeout: 10_000 },
                    );
                    if (searchResult.code !== 0) {
                        return fail(`搜索 Issue 失败：${searchResult.stderr || searchResult.stdout}`);
                    }

                    interface SearchIssue {
                        iid: number;
                        title: string;
                    }

                    let issues: SearchIssue[];
                    try {
                        issues = JSON.parse(searchResult.stdout);
                    } catch {
                        return fail('解析搜索结果失败。');
                    }

                    if (!Array.isArray(issues) || issues.length === 0) {
                        return fail(`未找到包含 "${params.issue}" 的开放 Issue。`);
                    }
                    if (issues.length > 1) {
                        return fail(
                            `找到多个匹配 Issue，请使用编号指定：\n` +
                                issues.map(i => `- #${i.iid}: ${i.title}`).join('\n'),
                        );
                    }
                    issueIid = issues[0].iid;
                }

                const viewResult = await pi.exec(
                    'glab',
                    ['issue', 'view', String(issueIid), '--output', 'json'],
                    { cwd, timeout: 10_000 },
                );

                if (viewResult.code !== 0) {
                    return fail(`读取 Issue 失败：${viewResult.stderr || viewResult.stdout}`);
                }

                interface GlIssueDetail {
                    iid: number;
                    title: string;
                    description: string;
                    labels: string[];
                    state: string;
                    web_url: string;
                }

                let detail: GlIssueDetail;
                try {
                    detail = JSON.parse(viewResult.stdout);
                } catch {
                    return fail('解析 Issue 详情失败。');
                }

                const labels = detail.labels?.join(', ') || '无';
                const lines: string[] = [];
                lines.push(`## Issue #${detail.iid}: ${detail.title}`);
                lines.push(`- 状态: ${detail.state}`);
                lines.push(`- 标签: ${labels}`);
                lines.push(`- URL: ${detail.web_url}`);
                lines.push('');
                lines.push('### 描述');
                lines.push(detail.description || '（无描述）');
                lines.push('');
                lines.push('---');

                // 模型档位自动路由
                const tierConfig = loadTierConfig();
                const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
                const currentTier = currentModelId ? getModelTier(tierConfig, currentModelId) : null;

                lines.push('### 建议的任务拆分框架');
                lines.push('根据 Issue 内容，可按以下维度拆分子任务：');
                lines.push('');

                const taskDimensions = [
                    { key: 'frontend', name: '前端/UI', desc: '页面组件、交互逻辑、样式调整' },
                    { key: 'backend', name: '后端/API', desc: '接口设计、数据模型、业务逻辑' },
                    { key: 'test', name: '测试', desc: '单元测试、集成测试、E2E 测试' },
                    { key: 'docs', name: '文档', desc: 'README、API 文档、CHANGELOG' },
                    { key: 'config', name: '配置/部署', desc: 'CI/CD、环境变量、依赖升级' },
                ];

                for (const dim of taskDimensions) {
                    const { recommendedTier, routedTier, models, fallback } = recommendModelForTask(
                        tierConfig,
                        dim.key,
                    );
                    const tierLabel =
                        routedTier === 'high' ? '高档' : routedTier === 'medium' ? '中档' : '低档';
                    const recLabel =
                        recommendedTier === 'high'
                            ? '高档'
                            : recommendedTier === 'medium'
                              ? '中档'
                              : '低档';
                    const fallbackNote = fallback ? `（${recLabel}无模型，自动升至${tierLabel}）` : '';
                    const modelList = models.slice(0, 3).join(' / ');
                    const moreModels = models.length > 3 ? ` 等 ${models.length} 个` : '';

                    lines.push(
                        `1. **${dim.name}** — ${dim.desc} ${fallbackNote}`,
                    );
                    lines.push(`   - 推荐档位：${recLabel} → 实际路由：${tierLabel}`);
                    lines.push(`   - 可用模型：${modelList}${moreModels}`);
                    if (currentTier && currentTier !== routedTier) {
                        lines.push(
                            `   - ⚠️ 当前模型档位（${currentTier === 'high' ? '高档' : currentTier === 'medium' ? '中档' : '低档'}）与推荐档位不匹配，建议切换到 ${modelList.split(' / ')[0] ?? '对应档位模型'}`,
                        );
                    }
                }

                lines.push('');
                lines.push('请结合 Issue 描述，判断哪些维度涉及本次需求，逐一实现。');
                lines.push('');
                lines.push('> 💡 用 `raccoon_model_config action=get` 查看/修改模型档位配置。');

                return ok(lines.join('\n'));
            }

            if (host === 'gitee') {
                return fail('暂不支持通过工具获取 Gitee Issue 详情。');
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });

    // ════════════════════════════════════════════════════════
    // 11. raccoon_model_config
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_model_config',
        label: '模型档位配置',
        description:
            '设置或查看模型档位（high/medium/low）。档位用于任务自动路由。配置保存在 ~/.config/raccoon-agents/models.json。',
        parameters: Type.Object({
            action: Type.Union(
                [
                    Type.Literal('set', { description: '设置模型档位' }),
                    Type.Literal('get', { description: '查看当前配置' }),
                    Type.Literal('remove', { description: '删除模型档位' }),
                ],
                { description: '操作类型：set/get/remove' },
            ),
            model: Type.Optional(Type.String({ description: '模型 ID（如 openai/gpt-4o）' })),
            tier: Type.Optional(
                Type.Union(
                    [Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')],
                    { description: '档位：high（高档）/ medium（中档）/ low（低档）' },
                ),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const config = loadTierConfig();

            if (params.action === 'get') {
                const lines: string[] = [];
                lines.push('## 模型档位配置');
                lines.push('');
                lines.push('| 模型 | 档位 |');
                lines.push('|------|------|');

                const byTier: Record<ModelTier, string[]> = { high: [], medium: [], low: [] };
                for (const [modelId, tier] of Object.entries(config.models)) {
                    byTier[tier].push(modelId);
                }

                for (const tier of ['high', 'medium', 'low'] as ModelTier[]) {
                    if (byTier[tier].length > 0) {
                        lines.push(`| **${tier === 'high' ? '高档' : tier === 'medium' ? '中档' : '低档'}** | |`);
                        for (const modelId of byTier[tier]) {
                            const marker =
                                ctx.model && (modelId === `${ctx.model.provider}/${ctx.model.id}` ||
                                    `${ctx.model.provider}/${ctx.model.id}`.startsWith(modelId))
                                    ? ' ← 当前'
                                    : '';
                            lines.push(`| ${modelId} | ${tier}${marker} |`);
                        }
                    }
                }

                lines.push('');
                lines.push('### 使用示例');
                lines.push('```');
                lines.push('raccoon_model_config action=set model=openai/gpt-4o tier=high');
                lines.push('raccoon_model_config action=set model=openai/gpt-4o-mini tier=low');
                lines.push('raccoon_model_config action=remove model=openai/gpt-4o-mini');
                lines.push('```');

                return ok(lines.join('\n'));
            }

            if (params.action === 'set') {
                if (!params.model || !params.tier) {
                    return fail('set 操作需要提供 model 和 tier 参数。');
                }
                setModelTier(config, params.model, params.tier);
                return ok(`✅ 已设置 ${params.model} 为 ${params.tier} 档`);
            }

            if (params.action === 'remove') {
                if (!params.model) {
                    return fail('remove 操作需要提供 model 参数。');
                }
                const removed = removeModelTier(config, params.model);
                if (removed) {
                    return ok(`✅ 已删除 ${params.model} 的档位配置`);
                }
                return fail(`未找到 ${params.model} 的档位配置`);
            }

            return fail(`未知操作：${params.action}`);
        },
    });

    // ════════════════════════════════════════════════════════
    // 12. raccoon_model_list
    // ════════════════════════════════════════════════════════

    pi.registerTool({
        name: 'raccoon_model_list',
        label: '模型档位列表',
        description: '列出当前所有模型的档位配置，按档位分组展示。',
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const config = loadTierConfig();
            const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
            const currentTier = currentModelId ? getModelTier(config, currentModelId) : null;

            const lines: string[] = [];
            lines.push('## 模型档位配置');
            if (currentModelId) {
                lines.push(`当前模型：**${currentModelId}** (${currentTier ?? '未配置'})`);
            }
            lines.push('');

            for (const tier of ['high', 'medium', 'low'] as ModelTier[]) {
                const models = getModelsByTier(config, tier);
                const tierLabel = tier === 'high' ? '🔴 高档' : tier === 'medium' ? '🟡 中档' : '🟢 低档';
                lines.push(`### ${tierLabel}（${models.length} 个）`);
                if (models.length === 0) {
                    lines.push('（无）');
                } else {
                    for (const modelId of models) {
                        const marker = currentModelId === modelId ? ' ← 当前' : '';
                        lines.push(`- ${modelId}${marker}`);
                    }
                }
                lines.push('');
            }

            lines.push('---');
            lines.push('### 路由规则');
            lines.push('- 前端/UI → 中档');
            lines.push('- 后端/API → 高档');
            lines.push('- 测试 → 低档');
            lines.push('- 文档 → 中档');
            lines.push('- 配置/部署 → 低档');
            lines.push('');
            lines.push('若推荐档位无模型，自动 fallback 到更高档。');

            return ok(lines.join('\n'));
        },
    });
}
