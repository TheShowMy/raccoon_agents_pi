import { describe, it, expect } from 'vitest';
import { parseFrontmatter, sanitizeFilename } from '../subagent.js';

describe('parseFrontmatter', () => {
    it('基本键值对', () => {
        const content = `---
name: 逻辑审核员
description: 审核逻辑
model: gpt-4
---
请审核代码。`;
        const { frontmatter, body } = parseFrontmatter(content);
        expect(frontmatter.name).toBe('逻辑审核员');
        expect(frontmatter.description).toBe('审核逻辑');
        expect(frontmatter.model).toBe('gpt-4');
        expect(body.trim()).toBe('请审核代码。');
    });

    it('支持连字符键名', () => {
        const content = `---
model-name: gpt-4
base-url: https://api.example.com
---
body`;
        const { frontmatter } = parseFrontmatter(content);
        expect(frontmatter['model-name']).toBe('gpt-4');
        expect(frontmatter['base-url']).toBe('https://api.example.com');
    });

    it('支持多行缩进值', () => {
        const content = `---
prompt: 第一行
  第二行缩进
  第三行缩进
---
body`;
        const { frontmatter } = parseFrontmatter(content);
        expect(frontmatter.prompt).toBe('第一行\n第二行缩进\n第三行缩进');
    });

    it('无 frontmatter 时返回全部内容', () => {
        const content = '没有 frontmatter 的内容';
        const { frontmatter, body } = parseFrontmatter(content);
        expect(Object.keys(frontmatter).length).toBe(0);
        expect(body).toBe(content);
    });

    it('空值键', () => {
        const content = `---
name: 审核员
description:
---
body`;
        const { frontmatter } = parseFrontmatter(content);
        expect(frontmatter.name).toBe('审核员');
        expect(frontmatter.description).toBe('');
    });
});

describe('sanitizeFilename', () => {
    it('过滤特殊字符', () => {
        expect(sanitizeFilename('hello world/..')).toBe('hello_world___');
        expect(sanitizeFilename('a@b#c$d')).toBe('a_b_c_d');
    });

    it('保留合法字符', () => {
        expect(sanitizeFilename('abc-123_DEF')).toBe('abc-123_DEF');
    });

    it('空字符串', () => {
        expect(sanitizeFilename('')).toBe('');
    });
});
