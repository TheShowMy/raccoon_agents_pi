import { describe, it, expect } from 'vitest';
import { parseGitStatusOutput, isGitStatusClean } from '../git-utils.js';

describe('parseGitStatusOutput', () => {
    it('解析干净的主分支', () => {
        const output = '## main...origin/main [ahead 2, behind 1]';
        const status = parseGitStatusOutput(output);

        expect(status.branch).toBe('main');
        expect(status.upstream).toBe('origin/main');
        expect(status.ahead).toBe(2);
        expect(status.behind).toBe(1);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
        expect(status.untracked).toBe(0);
        expect(status.conflicts).toBe(0);
    });

    it('解析有暂存、未暂存、未跟踪文件', () => {
        const output = [
            '## feat/test...origin/feat/test',
            'M  index.ts',
            ' M extensions/git-utils.ts',
            '?? new-file.txt',
            'A  staged-add.ts',
            'D  deleted.ts',
            'R  old.ts -> new.ts',
        ].join('\n');

        const status = parseGitStatusOutput(output);

        expect(status.branch).toBe('feat/test');
        expect(status.staged).toBe(4); // M, A, D, R
        expect(status.unstaged).toBe(1); // M (worktree)
        expect(status.untracked).toBe(1);
        expect(status.conflicts).toBe(0);
    });

    it('解析冲突文件', () => {
        const output = [
            '## main',
            'UU conflict.ts',
            'AA both-added.ts',
            'DD both-deleted.ts',
        ].join('\n');

        const status = parseGitStatusOutput(output);

        expect(status.conflicts).toBe(3);
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
    });

    it('解析无上游分支', () => {
        const output = '## feat/no-upstream';
        const status = parseGitStatusOutput(output);

        expect(status.branch).toBe('feat/no-upstream');
        expect(status.upstream).toBeUndefined();
        expect(status.ahead).toBe(0);
        expect(status.behind).toBe(0);
    });

    it('解析空字符串', () => {
        const status = parseGitStatusOutput('');

        expect(status.branch).toBe('unknown');
        expect(status.staged).toBe(0);
        expect(status.unstaged).toBe(0);
        expect(status.untracked).toBe(0);
    });
});

describe('isGitStatusClean', () => {
    it('干净状态返回 true', () => {
        const status = parseGitStatusOutput('## main');
        expect(isGitStatusClean(status)).toBe(true);
    });

    it('有未暂存文件返回 false', () => {
        const status = parseGitStatusOutput('## main\n M file.ts');
        expect(isGitStatusClean(status)).toBe(false);
    });

    it('有暂存文件返回 false', () => {
        const status = parseGitStatusOutput('## main\nM  file.ts');
        expect(isGitStatusClean(status)).toBe(false);
    });

    it('有未跟踪文件返回 false', () => {
        const status = parseGitStatusOutput('## main\n?? file.ts');
        expect(isGitStatusClean(status)).toBe(false);
    });

    it('有冲突文件返回 false', () => {
        const status = parseGitStatusOutput('## main\nUU file.ts');
        expect(isGitStatusClean(status)).toBe(false);
    });
});
