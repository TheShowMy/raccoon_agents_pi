import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getModelTier,
    setModelTier,
    removeModelTier,
    routeModel,
    recommendModelForTask,
    type TierConfig,
} from '../model-tier.js';

describe('getModelTier', () => {
    it('精确匹配', () => {
        const config: TierConfig = {
            models: { 'openai/gpt-4o': 'high' },
        };
        expect(getModelTier(config, 'openai/gpt-4o')).toBe('high');
    });

    it('前缀匹配', () => {
        const config: TierConfig = {
            models: { 'openai/': 'high' },
        };
        expect(getModelTier(config, 'openai/gpt-4o')).toBe('high');
    });

    it('禁止反向前缀匹配', () => {
        const config: TierConfig = {
            models: { 'openai/gpt-4o': 'high' },
        };
        // "openai/" 不应匹配 "openai/gpt-4o" 的反向
        // 之前的 bug：key.startsWith(modelId) 会让 "a" 匹配 "anthropic/claude"
        expect(getModelTier(config, 'a')).toBeNull();
        expect(getModelTier(config, 'openai')).toBeNull();
    });

    it('未配置返回 null', () => {
        const config: TierConfig = { models: {} };
        expect(getModelTier(config, 'openai/gpt-4o')).toBeNull();
    });
});

describe('routeModel', () => {
    it('推荐低档且低档有模型', () => {
        const config: TierConfig = {
            models: {
                'deepseek/deepseek-v4-flash': 'low',
                'deepseek/deepseek-v4-pro': 'medium',
            },
        };
        const result = routeModel(config, 'low');
        expect(result.tier).toBe('low');
        expect(result.models).toContain('deepseek/deepseek-v4-flash');
        expect(result.fallback).toBe(false);
    });

    it('推荐低档但低档无模型，fallback 到中档', () => {
        const config: TierConfig = {
            models: {
                'deepseek/deepseek-v4-pro': 'medium',
            },
        };
        const result = routeModel(config, 'low');
        expect(result.tier).toBe('medium');
        expect(result.fallback).toBe(true);
    });

    it('推荐低档但低档中档都无模型，fallback 到高档', () => {
        const config: TierConfig = {
            models: {
                'kimi-coding/kimi-for-coding': 'high',
            },
        };
        const result = routeModel(config, 'low');
        expect(result.tier).toBe('high');
        expect(result.fallback).toBe(true);
    });

    it('无配置时返回空数组', () => {
        const config: TierConfig = { models: {} };
        const result = routeModel(config, 'high');
        expect(result.models).toEqual([]);
        expect(result.fallback).toBe(true);
    });
});

describe('recommendModelForTask', () => {
    it('后端任务推荐高档', () => {
        const config: TierConfig = {
            models: { 'kimi-coding/kimi-for-coding': 'high' },
        };
        const result = recommendModelForTask(config, 'backend');
        expect(result.recommendedTier).toBe('high');
        expect(result.routedTier).toBe('high');
    });

    it('前端任务推荐中档', () => {
        const config: TierConfig = {
            models: { 'deepseek/deepseek-v4-pro': 'medium' },
        };
        const result = recommendModelForTask(config, 'frontend');
        expect(result.recommendedTier).toBe('medium');
        expect(result.routedTier).toBe('medium');
    });

    it('未知任务类型默认中档', () => {
        const config: TierConfig = {
            models: { 'deepseek/deepseek-v4-pro': 'medium' },
        };
        const result = recommendModelForTask(config, 'unknown');
        expect(result.recommendedTier).toBe('medium');
    });
});
