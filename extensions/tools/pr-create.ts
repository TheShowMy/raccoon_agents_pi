import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost, gitExec } from '../git-utils.js';
import { ok, fail, currentBranch } from './common.js';

export function registerPrCreateTool(pi: ExtensionAPI): void {
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
}
