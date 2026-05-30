/**
 * Git 工具函数 — 被 index.ts / project-info.ts / git-workflow.ts 共享。
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export interface GitStatus {
    kind: 'loading' | 'ready' | 'not-git' | 'error';
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
    staged: number;
    unstaged: number;
    untracked: number;
    conflicts: number;
    error?: string;
}

export const EMPTY_GIT_STATUS: GitStatus = {
    kind: 'loading',
    branch: 'loading',
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
};

function parseBranchHeader(line: string, status: GitStatus) {
    const body = line.slice(3).trim();
    const bracketIndex = body.indexOf(' [');
    const branchPart = bracketIndex >= 0 ? body.slice(0, bracketIndex) : body;
    const meta = bracketIndex >= 0 ? body.slice(bracketIndex + 2, -1) : '';
    const [branch, upstream] = branchPart.split('...');

    status.branch = branch || 'unknown';
    status.upstream = upstream;

    const ahead = meta.match(/ahead (\d+)/);
    const behind = meta.match(/behind (\d+)/);
    status.ahead = ahead ? Number(ahead[1]) : 0;
    status.behind = behind ? Number(behind[1]) : 0;
}

export function parseGitStatusOutput(stdout: string): GitStatus {
    const status: GitStatus = {
        ...EMPTY_GIT_STATUS,
        kind: 'ready',
        branch: 'unknown',
    };

    for (const line of stdout.split(/\r?\n/)) {
        if (!line) continue;
        if (line.startsWith('## ')) {
            parseBranchHeader(line, status);
            continue;
        }

        const indexStatus = line[0] ?? ' ';
        const worktreeStatus = line[1] ?? ' ';
        const pair = `${indexStatus}${worktreeStatus}`;

        if (pair === '??') {
            status.untracked++;
            continue;
        }

        if (indexStatus === 'U' || worktreeStatus === 'U' || pair === 'AA' || pair === 'DD') {
            status.conflicts++;
            continue;
        }

        if (indexStatus !== ' ' && indexStatus !== '?') {
            status.staged++;
        }
        if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
            status.unstaged++;
        }
    }

    return status;
}

export function isGitStatusClean(status: GitStatus): boolean {
    return status.staged + status.unstaged + status.untracked + status.conflicts === 0;
}

export async function isGitWorkTree(pi: ExtensionAPI, cwd: string): Promise<boolean> {
    const result = await pi.exec('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd,
        timeout: 1_500,
    });
    return result.code === 0 && result.stdout.trim() === 'true';
}

export async function readGitStatus(pi: ExtensionAPI, cwd: string): Promise<GitStatus> {
    const result = await pi.exec('git', ['status', '--porcelain=v1', '--branch'], {
        cwd,
        timeout: 1_500,
    });

    if (result.code === 0) {
        return parseGitStatusOutput(result.stdout);
    }

    const detail = (result.stderr || result.stdout).trim();
    if (/not a git repository/i.test(detail)) {
        return { ...EMPTY_GIT_STATUS, kind: 'not-git', branch: 'no git' };
    }

    return {
        ...EMPTY_GIT_STATUS,
        kind: 'error',
        branch: 'git error',
        error: detail.split(/\r?\n/).slice(-1)[0] || `git exited ${result.code}`,
    };
}

/** 执行 git 命令并返回结果，失败时返回 null + 错误信息 */
export async function gitExec(
    pi: ExtensionAPI,
    args: string[],
    cwd: string,
    timeout = 10_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
    return pi.exec('git', args, { cwd, timeout });
}
