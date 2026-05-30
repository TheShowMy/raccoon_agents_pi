import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadTierConfig, getModelsByTier } from '../model-tier.js';
import { ok } from './common.js';

export function registerModelListTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_model_list',
        label: '模型档位列表',
        description: '列出当前所有模型的档位配置（含已配置和未配置），按档位分组展示。',
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const tierConfig = loadTierConfig();
            const lines: string[] = [];

            lines.push('## 模型档位列表');
            lines.push('');

            const highModels = getModelsByTier(tierConfig, 'high');
            const mediumModels = getModelsByTier(tierConfig, 'medium');
            const lowModels = getModelsByTier(tierConfig, 'low');
            const allConfigured = new Set([...highModels, ...mediumModels, ...lowModels]);

            if (highModels.length > 0) {
                lines.push('🔴 **高档（high）**');
                for (const m of highModels) {
                    const isCurrent = ctx.model && `${ctx.model.provider}/${ctx.model.id}` === m;
                    lines.push(`  ${isCurrent ? '→' : '  '} ${m}`);
                }
                lines.push('');
            }

            if (mediumModels.length > 0) {
                lines.push('🟡 **中档（medium）**');
                for (const m of mediumModels) {
                    const isCurrent = ctx.model && `${ctx.model.provider}/${ctx.model.id}` === m;
                    lines.push(`  ${isCurrent ? '→' : '  '} ${m}`);
                }
                lines.push('');
            }

            if (lowModels.length > 0) {
                lines.push('🟢 **低档（low）**');
                for (const m of lowModels) {
                    const isCurrent = ctx.model && `${ctx.model.provider}/${ctx.model.id}` === m;
                    lines.push(`  ${isCurrent ? '→' : '  '} ${m}`);
                }
                lines.push('');
            }

            return ok(lines.join('\n'));
        },
    });
}
