import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, readGitStatus } from '../git-utils.js';
import { ok, fail, currentBranch } from './common.js';
import { gitExec } from '../git-utils.js';

export function registerFeatureNewTool(pi: ExtensionAPI): void {
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

            const BRANCH_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
            if (!BRANCH_NAME_REGEX.test(params.name)) {
                return fail(
                    `功能名 "${params.name}" 包含非法字符。只允许字母、数字、下划线和连字符。`,
                );
            }

            const branch = `feat/${params.name}`;
            const originalBranch = await currentBranch(pi, cwd);

            const checkoutMain = await gitExec(pi, ['checkout', 'main'], cwd);
            if (checkoutMain.code !== 0) {
                return fail(`无法切换到 main 分支：${checkoutMain.stderr || checkoutMain.stdout}`);
            }

            const create = await gitExec(pi, ['checkout', '-b', branch], cwd);
            if (create.code !== 0) {
                if (originalBranch) {
                    await gitExec(pi, ['checkout', originalBranch], cwd);
                }
                return fail(`创建分支 ${branch} 失败：${create.stderr || create.stdout}`);
            }

            return ok(`✅ 已创建并切换到分支 ${branch}\n工作区干净，可以开始开发。`);
        },
    });
}
