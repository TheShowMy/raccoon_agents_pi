/**
 * 模型档位管理 — 支持 high / medium / low 三档配置与自动路由
 *
 * 配置存储在 ~/.config/raccoon-agents/models.json
 * 不提供默认模型，仅从用户实际配置的模型中读取
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';

export type ModelTier = 'high' | 'medium' | 'low';

export interface TierConfig {
    models: Record<string, ModelTier>;
}

const CONFIG_DIR = join(homedir(), '.config', 'raccoon-agents');
const CONFIG_FILE = join(CONFIG_DIR, 'models.json');

/** 任务类型到推荐档位的映射 */
export const TASK_TIER_MAP: Record<string, ModelTier> = {
    frontend: 'medium',
    backend: 'high',
    test: 'low',
    docs: 'medium',
    config: 'low',
};

function ensureConfigDir(): void {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadTierConfig(): TierConfig {
    if (!existsSync(CONFIG_FILE)) {
        return { models: {} };
    }
    try {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TierConfig>;
        return { models: parsed.models ?? {} };
    } catch {
        return { models: {} };
    }
}

export function saveTierConfig(config: TierConfig): void {
    ensureConfigDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/** 从 Pi ModelRegistry 获取所有已配置模型（含内置） */
export function scanAllModels(registry: ModelRegistry): string[] {
    return registry.getAll().map((m) => `${m.provider}/${m.id}`);
}

/** 从 Pi ModelRegistry 获取已配置且可用的模型（有 API key） */
export function scanAvailableModels(registry: ModelRegistry): string[] {
    return registry.getAvailable().map((m) => `${m.provider}/${m.id}`);
}

export function getModelTier(config: TierConfig, modelId: string): ModelTier | null {
    if (config.models[modelId]) {
        return config.models[modelId];
    }
    for (const [key, tier] of Object.entries(config.models)) {
        // 只支持 modelId 以 key 为前缀的匹配（如 provider 级别匹配）
        // 避免 openai/ 匹配到 openai-compatible/xxx：
        // - 若 key 本身以 / 或 - 结尾，允许任何以 key 开头的 modelId
        // - 否则要求 modelId 在 key 后紧跟 / 或 -，确保是完整前缀段
        if (modelId.startsWith(key)) {
            const nextChar = modelId[key.length];
            if (
                nextChar === undefined ||
                nextChar === '/' ||
                nextChar === '-' ||
                key.endsWith('/') ||
                key.endsWith('-')
            ) {
                return tier;
            }
        }
    }
    return null;
}

export function setModelTier(config: TierConfig, modelId: string, tier: ModelTier): void {
    config.models[modelId] = tier;
    saveTierConfig(config);
}

export function removeModelTier(config: TierConfig, modelId: string): boolean {
    if (config.models[modelId]) {
        delete config.models[modelId];
        saveTierConfig(config);
        return true;
    }
    return false;
}

export function getModelsByTier(config: TierConfig, tier: ModelTier): string[] {
    return Object.entries(config.models)
        .filter(([, t]) => t === tier)
        .map(([id]) => id);
}

/** 自动路由：根据推荐档位获取可用模型，若该档位无模型则 fallback 到更高档 */
export function routeModel(
    config: TierConfig,
    requiredTier: ModelTier,
): { tier: ModelTier; models: string[]; fallback: boolean } {
    const tierOrder: ModelTier[] = ['low', 'medium', 'high'];
    const startIndex = tierOrder.indexOf(requiredTier);

    for (let i = startIndex; i < tierOrder.length; i++) {
        const tier = tierOrder[i];
        const models = getModelsByTier(config, tier);
        if (models.length > 0) {
            return { tier, models, fallback: i > startIndex };
        }
    }

    const allModels = Object.keys(config.models);
    return { tier: 'high', models: allModels, fallback: true };
}

export function recommendModelForTask(
    config: TierConfig,
    taskType: string,
): { recommendedTier: ModelTier; routedTier: ModelTier; models: string[]; fallback: boolean } {
    const recommendedTier = TASK_TIER_MAP[taskType] ?? 'medium';
    const { tier, models, fallback } = routeModel(config, recommendedTier);
    return { recommendedTier, routedTier: tier, models, fallback };
}
