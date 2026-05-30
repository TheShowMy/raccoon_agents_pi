import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, gitExec } from '../git-utils.js';
import { ok, fail, currentBranch } from './common.js';

export function registerGitPushTool(pi: ExtensionAPI): void {
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
}
