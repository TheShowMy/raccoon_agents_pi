import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, gitExec } from '../git-utils.js';
import { ok, fail, currentBranch } from './common.js';

export function registerGitCommitTool(pi: ExtensionAPI): void {
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

            const branch = await currentBranch(pi, cwd);
            if (branch === 'main' || branch === 'master') {
                return fail(
                    '当前在 main/master 分支，禁止直接提交！\n' +
                    '正确流程：\n' +
                    '1. raccoon_feature_new 创建 feature 分支\n' +
                    '2. 编码修改\n' +
                    '3. 在 feature 分支上提交\n' +
                    '4. 推送 → 创建 PR → 合并到 main',
                );
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
}
