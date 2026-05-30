/**
 * 项目状态工具 — 注册 raccoon_project_info 工具，
 * 向 Agent 展示当前项目工作区概览。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { detectGitHost, gitExec, readGitStatus } from './git-utils.js';

/** 无参数的 TypeBox schema */
const NO_PARAMS = Type.Object({});

export function registerProjectInfoTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_project_info',
        label: '项目信息',
        description: '展示当前项目工作区概览：分支、Git 状态、package.json 信息',
        parameters: NO_PARAMS,
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const lines: string[] = [];

            // 1. Git 状态
            const status = await readGitStatus(pi, cwd);
            const { host, url } = await detectGitHost(pi, cwd);
            lines.push('## Git 状态');
            lines.push(`- 分支: ${status.branch}`);
            if (host !== 'unknown') {
                lines.push(`- 平台: ${host}${url ? ` (${url})` : ''}`);
            }
            if (status.upstream) {
                const aheadBehind: string[] = [];
                if (status.ahead > 0) aheadBehind.push(`领先 ${status.ahead}`);
                if (status.behind > 0) aheadBehind.push(`落后 ${status.behind}`);
                lines.push(`- 远程: ${status.upstream}${aheadBehind.length > 0 ? ` (${aheadBehind.join(', ')})` : ''}`);
            }
            const dirtyParts: string[] = [];
            if (status.staged > 0) dirtyParts.push(`暂存 ${status.staged}`);
            if (status.unstaged > 0) dirtyParts.push(`未暂存 ${status.unstaged}`);
            if (status.untracked > 0) dirtyParts.push(`未跟踪 ${status.untracked}`);
            if (status.conflicts > 0) dirtyParts.push(`冲突 ${status.conflicts}`);
            lines.push(`- 状态: ${dirtyParts.length > 0 ? dirtyParts.join(' / ') : '干净'}`);

            // 2. 是否有未推送提交
            if (status.upstream) {
                const unpushedResult = await gitExec(pi, ['log', `${status.upstream}..HEAD`, '--oneline'], cwd);
                if (unpushedResult.code === 0 && unpushedResult.stdout.trim()) {
                    const unpushedCount = unpushedResult.stdout.trim().split('\n').length;
                    lines.push(`- 未推送提交: ${unpushedCount}`);
                } else {
                    lines.push('- 未推送提交: 0');
                }
            } else {
                lines.push('- 未推送提交: 无远程跟踪分支');
            }

            // 3. package.json 信息
            const pkgPath = join(cwd, 'package.json');
            if (existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    lines.push('');
                    lines.push('## package.json');
                    if (pkg.name) lines.push(`- 名称: ${pkg.name}`);
                    if (pkg.version) lines.push(`- 版本: ${pkg.version}`);
                    if (pkg.scripts) {
                        const scripts = Object.keys(pkg.scripts).filter(k => !k.startsWith('_'));
                        if (scripts.length > 0) {
                            lines.push(`- 可用脚本: ${scripts.join(', ')}`);
                        }
                    }
                } catch {
                    lines.push('');
                    lines.push('## package.json');
                    lines.push('- (解析失败)');
                }
            } else {
                lines.push('');
                lines.push('## package.json');
                lines.push('- 不存在');
            }

            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                details: {},
            };
        },
    });
}
