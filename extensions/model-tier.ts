/**
 * 模型档位管理 — 支持 high / medium / low 三档配置与自动路由
 *
 * 配置存储在 ~/.config/raccoon-agents/models.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ModelTier = 'high' | 'medium' | 'low';

export interface TierConfig {
    models: Record<string, ModelTier>;
}

const CONFIG_DIR = join(homedir(), '.config', 'raccoon-agents');
const CONFIG_FILE = join(CONFIG_DIR, 'models.json');

/** 默认档位映射（常用模型） */
const DEFAULT_TIERS: Record<string, ModelTier> = {
    'anthropic/claude-sonnet-4': 'high',
    'anthropic/claude-sonnet-4-20250514': 'high',
    'openai/gpt-4o': 'high',
    'openai/gpt-4o-2024-11-20': 'high',
    'openai/gpt-4o-mini': 'low',
    'openai/gpt-4o-mini-2024-07-18': 'low',
    'google/gemini-2.5-pro': 'high',
    'google/gemini-2.5-flash': 'medium',
};

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
        return { models: { ...DEFAULT_TIERS } };
    }
    try {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TierConfig>;
        return { models: { ...DEFAULT_TIERS, ...parsed.models } };
    } catch {
        return { models: { ...DEFAULT_TIERS } };
    }
}

export function saveTierConfig(config: TierConfig): void {
    ensureConfigDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4) + '\n', 'utf-8');
}

export function getModelTier(config: TierConfig, modelId: string): ModelTier | null {
    // 精确匹配
    if (config.models[modelId]) {
        return config.models[modelId];
    }
    // 前缀匹配（如 anthropic/claude-sonnet-4 匹配 anthropic/claude-sonnet-4-20250514）
    for (const [key, tier] of Object.entries(config.models)) {
        if (modelId.startsWith(key) || key.startsWith(modelId)) {
            return tier;
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

/** 获取某档位下的所有模型 */
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

    // 兜底：返回所有已知模型
    const allModels = Object.keys(config.models);
    return { tier: 'high', models: allModels, fallback: true };
}

/** 为任务推荐模型档位并返回路由结果 */
export function recommendModelForTask(
    config: TierConfig,
    taskType: string,
): { recommendedTier: ModelTier; routedTier: ModelTier; models: string[]; fallback: boolean } {
    const recommendedTier = TASK_TIER_MAP[taskType] ?? 'medium';
    const { tier, models, fallback } = routeModel(config, recommendedTier);
    return { recommendedTier, routedTier: tier, models, fallback };
}
