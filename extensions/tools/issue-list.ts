import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost } from '../git-utils.js';
import { ok, fail } from './common.js';

export function registerIssueListTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_issue_list',
        label: 'Issue 列表',
        description: '列出最近的开放 Issue。支持 GitHub (gh)、GitLab (glab)。',
        parameters: Type.Object({
            limit: Type.Optional(Type.Number({ description: '返回数量，默认 10' })),
            label: Type.Optional(Type.String({ description: '按标签筛选（可选）' })),
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

                let issues: Array<{ number: number; title: string; labels: Array<{ name: string }>; url: string }>;
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

                let issues: Array<{ iid: number; title: string; labels: string[]; web_url: string }>;
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
}
