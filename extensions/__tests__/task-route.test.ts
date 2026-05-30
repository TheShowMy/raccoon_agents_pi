import { describe, it, expect } from 'vitest';
import {
    sanitizeContextFile,
    sanitizeContextFiles,
    buildTaskWithContext,
    buildAgentConfig,
    formatSuccess,
    formatFailure,
    formatAllFailed,
} from '../tools/task-route.js';

describe('sanitizeContextFile', () => {
    it('允许正常相对路径', () => {
        expect(sanitizeContextFile('src/utils.ts')).toBe('src/utils.ts');
        expect(sanitizeContextFile('./src/utils.ts')).toBe('src/utils.ts');
        expect(sanitizeContextFile('README.md')).toBe('README.md');
    });

    it('拒绝包含 .. 的目录遍历', () => {
        expect(sanitizeContextFile('../etc/passwd')).toBeNull();
        expect(sanitizeContextFile('foo/../../etc/passwd')).toBeNull();
        expect(sanitizeContextFile('./../secret.txt')).toBeNull();
    });

    it('拒绝绝对路径', () => {
        expect(sanitizeContextFile('/etc/passwd')).toBeNull();
        expect(sanitizeContextFile('/Users/theshow/.ssh/id_rsa')).toBeNull();
    });

    it('拒绝 Windows 盘符路径', () => {
        expect(sanitizeContextFile('C:\\Windows\\System32')).toBeNull();
        expect(sanitizeContextFile('D:/secret.txt')).toBeNull();
    });

    it('拒绝空值', () => {
        expect(sanitizeContextFile('')).toBeNull();
        expect(sanitizeContextFile(null as unknown as string)).toBeNull();
        expect(sanitizeContextFile(undefined as unknown as string)).toBeNull();
    });
});

describe('sanitizeContextFiles', () => {
    it('过滤掉非法路径', () => {
        const input = ['src/utils.ts', '../etc/passwd', 'README.md', '/abs/path', 'foo/../../x'];
        const result = sanitizeContextFiles(input);
        expect(result).toEqual(['src/utils.ts', 'README.md']);
    });

    it('空数组返回空', () => {
        expect(sanitizeContextFiles([])).toEqual([]);
    });
});

describe('buildTaskWithContext', () => {
    it('无文件时返回原任务', () => {
        expect(buildTaskWithContext('写个测试', [])).toBe('写个测试');
    });

    it('有文件时追加文件列表', () => {
        const result = buildTaskWithContext('写个测试', ['src/math.ts', 'tests/math.test.ts']);
        expect(result).toContain('写个测试');
        expect(result).toContain('src/math.ts');
        expect(result).toContain('tests/math.test.ts');
    });
});

describe('buildAgentConfig', () => {
    it('首次执行不含 fallback 提示', () => {
        const config = buildAgentConfig('test', 'low', 'deepseek/deepseek-v4-flash', false);
        expect(config.name).toBe('test任务执行员');
        expect(config.model).toBe('deepseek/deepseek-v4-flash');
        expect(config.systemPrompt).toContain('测试工程师');
        expect(config.systemPrompt).not.toContain('重试');
    });

    it('重试时追加 fallback 提示', () => {
        const config = buildAgentConfig('docs', 'high', 'kimi-coding/kimi-for-coding', true);
        expect(config.name).toBe('docs任务执行员');
        expect(config.systemPrompt).toContain('技术文档工程师');
        expect(config.systemPrompt).toContain('更高档模型重试');
    });

    it('未知任务类型回退到 backend prompt', () => {
        const config = buildAgentConfig('unknown', 'medium', 'deepseek/deepseek-v4-pro', false);
        expect(config.systemPrompt).toContain('后端工程师');
    });
});

describe('formatSuccess', () => {
    it('包含 stdout 和 stderr', () => {
        const result = formatSuccess(
            ['🎯 路由'],
            {
                exitCode: 0,
                stdout: '输出内容',
                stderr: '[info: 心跳延长 1 次]',
            } as any,
        );
        expect(result).toContain('✅ 任务执行成功');
        expect(result).toContain('输出内容');
        expect(result).toContain('[info: 心跳延长 1 次]');
    });

    it('stdout 为空白且 stderr 为空时不输出额外空块', () => {
        const result = formatSuccess(['🎯 路由'], { exitCode: 0, stdout: '  ', stderr: '' } as any);
        expect(result).toContain('✅ 任务执行成功');
        expect(result).not.toContain('📋 日志');
    });
});

describe('formatFailure', () => {
    it('超时场景', () => {
        const result = formatFailure(['🎯 路由'], { timedOut: true, exitCode: 0, stderr: '' } as any, 'low');
        expect(result).toContain('❌ low 档执行失败：超时');
    });

    it('非零退出码场景', () => {
        const result = formatFailure(
            ['🎯 路由'],
            { timedOut: false, exitCode: 1, stderr: 'error msg' } as any,
            'medium',
        );
        expect(result).toContain('❌ medium 档执行失败：退出码 1');
        expect(result).toContain('error msg');
    });
});

describe('formatAllFailed', () => {
    it('包含诊断建议', () => {
        const result = formatAllFailed();
        expect(result).toContain('所有可用档位均执行失败');
        expect(result).toContain('raccoon_model_scan');
    });
});
