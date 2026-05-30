import { describe, it, expect } from 'vitest';
import { parseDiff, generateReviewReport, formatDiffForReview } from '../code-review.js';

describe('parseDiff', () => {
    it('解析简单 diff', () => {
        const diff = [
            'diff --git a/index.ts b/index.ts',
            'index abc123..def456 100644',
            '--- a/index.ts',
            '+++ b/index.ts',
            '@@ -1,3 +1,4 @@',
            ' const a = 1;',
            '-const b = 2;',
            '+const b = 3;',
            '+const c = 4;',
            ' console.log(a);',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.totalFiles).toBe(1);
        expect(stats.addedLines).toBe(2);
        expect(stats.removedLines).toBe(1);
        expect(stats.files[0].path).toBe('index.ts');
        expect(stats.files[0].status).toBe('modified');
        expect(stats.files[0].added).toBe(2);
        expect(stats.files[0].removed).toBe(1);
    });

    it('解析新增文件', () => {
        const diff = [
            'diff --git a/new.ts b/new.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/new.ts',
            '@@ -0,0 +1,3 @@',
            '+export const x = 1;',
            '+export const y = 2;',
            '+export const z = 3;',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.files[0].status).toBe('added');
        expect(stats.files[0].added).toBe(3);
        expect(stats.files[0].removed).toBe(0);
    });

    it('解析删除文件', () => {
        const diff = [
            'diff --git a/old.ts b/old.ts',
            'deleted file mode 100644',
            '--- a/old.ts',
            '+++ /dev/null',
            '@@ -1,2 +0,0 @@',
            '-export const a = 1;',
            '-export const b = 2;',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.files[0].status).toBe('removed');
        expect(stats.files[0].added).toBe(0);
        expect(stats.files[0].removed).toBe(2);
    });

    it('解析多个文件', () => {
        const diff = [
            'diff --git a/a.ts b/a.ts',
            '--- a/a.ts',
            '+++ b/a.ts',
            '@@ -1 +1 @@',
            '-x',
            '+y',
            'diff --git a/b.ts b/b.ts',
            '--- a/b.ts',
            '+++ b/b.ts',
            '@@ -1 +1 @@',
            '-a',
            '+b',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.totalFiles).toBe(2);
        expect(stats.files[0].path).toBe('a.ts');
        expect(stats.files[1].path).toBe('b.ts');
    });

    it('解析空 diff', () => {
        const stats = parseDiff('');
        expect(stats.totalFiles).toBe(0);
        expect(stats.addedLines).toBe(0);
    });

    it('风险评估：高风险文件（>50 行变更）', () => {
        const lines: string[] = [
            'diff --git a/huge.ts b/huge.ts',
            '--- a/huge.ts',
            '+++ b/huge.ts',
        ];
        for (let i = 0; i < 30; i++) {
            lines.push('+const x' + i + ' = ' + i + ';');
        }
        for (let i = 0; i < 30; i++) {
            lines.push('-const y' + i + ' = ' + i + ';');
        }

        const stats = parseDiff(lines.join('\n'));

        expect(stats.files[0].riskLevel).toBe('high');
    });

    it('风险评估：lockfile 变更', () => {
        const diff = [
            'diff --git a/package-lock.json b/package-lock.json',
            '--- a/package-lock.json',
            '+++ b/package-lock.json',
            '@@ -1 +1 @@',
            '-x',
            '+y',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.files[0].isLockfile).toBe(true);
        expect(stats.files[0].riskLevel).toBe('medium');
    });

    it('风险评估：测试文件低风险', () => {
        const diff = [
            'diff --git a/utils.test.ts b/utils.test.ts',
            '--- a/utils.test.ts',
            '+++ b/utils.test.ts',
            '@@ -1 +1 @@',
            '-x',
            '+y',
        ].join('\n');

        const stats = parseDiff(diff);

        expect(stats.files[0].isTest).toBe(true);
        expect(stats.files[0].riskLevel).toBe('low');
    });
});

describe('generateReviewReport', () => {
    it('生成报告包含风险摘要', () => {
        const diff = [
            'diff --git a/huge.ts b/huge.ts',
            '--- a/huge.ts',
            '+++ b/huge.ts',
        ];
        for (let i = 0; i < 60; i++) {
            diff.push('+const x' + i + ' = ' + i + ';');
        }

        const report = generateReviewReport(diff.join('\n'));

        expect(report.riskSummary.length).toBeGreaterThan(0);
        expect(report.riskSummary[0]).toContain('高风险文件');
        expect(report.activeAngles.length).toBeGreaterThan(0);
    });

    it('大 PR 提示拆分', () => {
        const lines: string[] = ['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts'];
        for (let i = 0; i < 250; i++) {
            lines.push('+x' + i + ';');
        }

        const report = generateReviewReport(lines.join('\n'));

        expect(report.riskSummary.some((r) => r.includes('拆分为更小的 PR'))).toBe(true);
    });
});

describe('formatDiffForReview', () => {
    it('短 diff 完整输出', () => {
        const diff = 'line1\nline2\nline3';
        const result = formatDiffForReview(diff, 10);

        expect(result).toContain('```diff');
        expect(result).toContain('line1');
        expect(result).toContain('```');
        expect(result).not.toContain('省略');
    });

    it('长 diff 截断输出', () => {
        const diff = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
        const result = formatDiffForReview(diff, 10);

        expect(result).toContain('```diff');
        expect(result).toContain('省略');
        expect(result).toContain('```');
    });
});
