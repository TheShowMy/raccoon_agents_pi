import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost } from '../git-utils.js';
import { ok, fail } from './common.js';

export function registerIssueCreateTool(pi: ExtensionAPI): void {
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
}
