/**
 * Git 工作流工具 — 注册 4 个 LLM 可调用工具，
 * 提供安全的、带校验的分支管理和提交流程。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { gitExec, isGitWorkTree, readGitStatus } from './git-utils.js';

// ── 辅助函数 ──────────────────────────────────────────────

/** 获取当前分支名，失败返回 null */
async function currentBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
    const r = await gitExec(pi, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (r.code !== 0) return null;
    return r.stdout.trim();
}

/** 格式化成功结果 */
function ok(text: string) {
    return { content: [{ type: 'text' as const, text }], details: {} };
}

/** 格式化失败结果 */
function fail(text: string) {
    return { content: [{ type: 'text' as const, text: `❌ ${text}` }], details: {} };
}

// ── 注册入口 ──────────────────────────────────────────────

export function registerGitWorkflowTools(pi: ExtensionAPI): void {
    // ── raccoon_feature_new ───────────────────────────────

    pi.registerTool({
        name: 'raccoon_feature_new',
        label: 'Feature New',
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

    // ── raccoon_git_commit ────────────────────────────────

    pi.registerTool({
        name: 'raccoon_git_commit',
        label: 'Git Commit',
        description: '暂存变更并提交。支持 conventional commits 格式。',
        parameters: Type.Object({
            message: Type.String({ description: '提交消息，使用 conventional commits 格式（feat:/fix:/refactor:/docs:/chore:）' }),
            files: Type.Optional(
                Type.Array(Type.String(), { description: '要暂存的文件列表（可选，不指定则 git add -A）' }),
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

    // ── raccoon_git_push ──────────────────────────────────

    pi.registerTool({
        name: 'raccoon_git_push',
        label: 'Git Push',
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

            const pushArgs = ['push', '--set-upstream', 'origin', branch];
            const pushResult = await gitExec(pi, pushArgs, cwd, 30_000);

            if (pushResult.code !== 0) {
                return fail(`推送失败：${pushResult.stderr || pushResult.stdout}`);
            }

            return ok(`✅ 推送成功\n\`${branch} → origin/${branch}\``);
        },
    });

    // ── raccoon_pr_create ─────────────────────────────────

    pi.registerTool({
        name: 'raccoon_pr_create',
        label: 'PR Create',
        description: '创建 Pull Request。需要安装 gh CLI。',
        parameters: Type.Object({
            title: Type.String({ description: 'PR 标题' }),
            body: Type.Optional(Type.String({ description: 'PR 描述（可选）' })),
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

            const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
            if (ghCheck.code !== 0) {
                return fail(
                    '未检测到 gh CLI。\n' +
                        '安装方法：brew install gh（macOS）或 https://cli.github.com/\n' +
                        '安装后需登录：gh auth login',
                );
            }

            const remoteCheck = await gitExec(pi, ['rev-parse', '--verify', `origin/${branch}`], cwd);
            if (remoteCheck.code !== 0) {
                return fail(
                    `远程分支 origin/${branch} 不存在。\n请先用 raccoon_git_push 推送分支后再创建 PR。`,
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
        },
    });
}
