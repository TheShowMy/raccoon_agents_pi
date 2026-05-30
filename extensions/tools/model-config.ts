import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadTierConfig, getModelTier, setModelTier, removeModelTier } from '../model-tier.js';
import { ok, fail } from './common.js';

export function registerModelConfigTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_model_config',
        label: '模型档位配置',
        description: '设置或查看模型档位（high/medium/low）。',
        parameters: Type.Object({
            action: Type.Union(
                [
                    Type.Literal('set', { description: '设置模型档位' }),
                    Type.Literal('get', { description: '查看当前配置' }),
                    Type.Literal('remove', { description: '删除模型档位' }),
                ],
                { description: '操作类型' },
            ),
            model: Type.Optional(Type.String({ description: '模型 ID（如 openai/gpt-4o）' })),
            tier: Type.Optional(
                Type.Union(
                    [Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')],
                    { description: '档位：high（高档）/ medium（中档）/ low（低档）' },
                ),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const tierConfig = loadTierConfig();
            const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;

            if (params.action === 'get') {
                const targetModel = params.model || currentModelId;
                if (!targetModel) {
                    return fail('未指定模型，且当前会话没有模型信息。');
                }
                const tier = getModelTier(tierConfig, targetModel);
                if (!tier) {
                    return ok(`模型 ${targetModel} 未配置档位。`);
                }
                const label = tier === 'high' ? '🔴 高档' : tier === 'medium' ? '🟡 中档' : '🟢 低档';
                return ok(`模型 ${targetModel} 的档位：${label}`);
            }

            if (params.action === 'set') {
                if (!params.model) {
                    return fail('设置档位需要指定 model 参数。');
                }
                if (!params.tier) {
                    return fail('设置档位需要指定 tier 参数（high/medium/low）。');
                }
                setModelTier(tierConfig, params.model, params.tier);
                const label = params.tier === 'high' ? '🔴 高档' : params.tier === 'medium' ? '🟡 中档' : '🟢 低档';
                return ok(`✅ 已将 ${params.model} 设置为 ${label}`);
            }

            if (params.action === 'remove') {
                if (!params.model) {
                    return fail('删除档位需要指定 model 参数。');
                }
                const success = removeModelTier(tierConfig, params.model);
                if (success) {
                    return ok(`✅ 已删除 ${params.model} 的档位配置。`);
                }
                return fail(`${params.model} 没有档位配置，无需删除。`);
            }

            return fail(`未知的 action：${params.action}`);
        },
    });
}
