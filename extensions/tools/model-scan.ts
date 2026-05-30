import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
    loadTierConfig,
    scanAllModels,
    scanAvailableModels,
    getModelTier,
    type ModelTier,
} from '../model-tier.js';
import { ok, fail } from './common.js';

export function registerModelScanTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_model_scan',
        label: '扫描模型并设置档位',
        description: '扫描 Pi 中已配置的所有模型，显示未设置档位的模型列表，可批量设置档位。',
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const tierConfig = loadTierConfig();
            const allModels = scanAllModels(ctx.modelRegistry);
            const availableModels = scanAvailableModels(ctx.modelRegistry);

            const lines: string[] = [];
            lines.push('## 模型扫描结果');
            lines.push(`- 所有模型：${allModels.length} 个`);
            lines.push(`- 可用模型（已配置 API key）：${availableModels.length} 个`);
            lines.push('');

            const unconfigured = availableModels.filter(
                (m) => !getModelTier(tierConfig, m),
            );

            if (unconfigured.length > 0) {
                lines.push(`### 未配置档位的可用模型（${unconfigured.length} 个）`);
                for (const modelId of unconfigured) {
                    lines.push(`- ${modelId}  [未配置]`);
                }
                lines.push('');
                lines.push('使用 `raccoon_model_config action=set model=xxx tier=high/medium/low` 设置档位。');
            } else {
                lines.push('✅ 所有可用模型已配置档位。');
            }

            const configured = availableModels.filter(
                (m) => getModelTier(tierConfig, m),
            );
            if (configured.length > 0) {
                lines.push('');
                lines.push('### 已配置档位的模型');
                for (const modelId of configured) {
                    const tier = getModelTier(tierConfig, modelId)!;
                    const tierLabel = tier === 'high' ? '🔴 高档' : tier === 'medium' ? '🟡 中档' : '🟢 低档';
                    lines.push(`- ${modelId}  ${tierLabel}`);
                }
            }

            return ok(lines.join('\n'));
        },
    });
}
