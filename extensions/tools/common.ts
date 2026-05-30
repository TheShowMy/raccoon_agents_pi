/**
 * Git 工作流工具 — 共享函数和类型
 */

import { homedir } from 'node:os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { gitExec } from '../git-utils.js';

/** 成功的工具返回 */
export function ok(text: string) {
    return { content: [{ type: 'text' as const, text }], details: {} };
}

/** 失败的工具返回（自动脱敏） */
export function fail(text: string) {
    return { content: [{ type: 'text' as const, text: `❌ ${sanitizeOutput(text)}` }], details: {} };
}

/** 清理命令输出中的敏感信息 */
export function sanitizeOutput(output: string): string {
    const lines = output.split('\n');
    const cleaned: string[] = [];
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (/\b(token|secret|key|password|credential|auth)\b.*[:=]/i.test(line)) {
            cleaned.push('[敏感信息已过滤]');
            continue;
        }
        if (line.includes(homedir())) {
            cleaned.push(line.replaceAll(homedir(), '~'));
            continue;
        }
        cleaned.push(line);
    }
    if (cleaned.length > 30) {
        return cleaned.slice(0, 15).join('\n') + '\n...（省略 ' + (cleaned.length - 30) + ' 行）...\n' + cleaned.slice(-15).join('\n');
    }
    return cleaned.join('\n');
}

/** 获取当前分支名，失败返回 null */
export async function currentBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
    const r = await gitExec(pi, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (r.code !== 0) return null;
    return r.stdout.trim();
}
