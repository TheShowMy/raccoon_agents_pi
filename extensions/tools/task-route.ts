/**
 * 任务路由工具 — 根据任务类型自动选择模型档位执行
 *
 * 支持：
 * 1. 按任务类型路由到 high/medium/low 档位模型
 * 2. 低档执行失败时自动 fallback 到更高档
 * 3. 任务拆分：大 diff 自动分片，避免单个子 agent 过载
 */

import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runSingleAgent, type AgentConfig } from '../subagent.js';
import { loadTierConfig, routeModel, type ModelTier, TASK_TIER_MAP } from '../model-tier.js';
import { ok, fail } from './common.js';

const TIER_ORDER: ModelTier[] = ['low', 'medium', 'high'];

const TASK_PROMPT_MAP: Record<string, string> = {
    test: `你是一位测试工程师。请根据需求编写高质量的单元测试。
要求：
- 使用 vitest 测试框架
- 覆盖正常路径、边界条件和错误路径
- 测试命名清晰描述场景
- 每个测试独立，不依赖外部状态`,

    docs: `你是一位技术文档工程师。请编写清晰、准确的技术文档。
要求：
- 使用中文
- 结构清晰（概述、用法、示例、注意事项）
- 代码示例可运行
- 避免过度包装，直接说重点`,

    config: `你是一位 DevOps 工程师。请处理配置相关的任务。
要求：
- 配置变更向后兼容
- 提供配置说明和默认值
- 验证配置语法正确`,

    frontend: `你是一位前端工程师。请处理 UI/UX 相关的开发任务。
要求：
- 代码简洁，避免过度设计
- 考虑响应式和可访问性
- 类型定义完整`,

    backend: `你是一位后端工程师。请处理 API/服务相关的开发任务。
要求：
- 接口设计 RESTful/GraphQL 规范
- 错误处理完整
- 考虑并发和性能`,
};

const FALLBACK_PROMPT = `

⚠️ 注意：由于之前使用低档模型执行此任务失败，现在由更高档模型重试。
请确保输出质量，完成任务目标。`;

export function registerTaskRouteTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_task_route',
        label: '任务路由',
        description:
            '根据任务类型自动选择模型档位执行，支持失败自动升级。' +
            '任务类型：test（测试）、docs（文档）、config（配置）、frontend（前端）、backend（后端）。',
        parameters: Type.Object({
            task: Type.String({ description: '任务描述，尽量具体' }),
            taskType: Type.String({
                description: '任务类型：test/docs/config/frontend/backend',
            }),
            contextFiles: Type.Optional(
                Type.Array(Type.String(), {
                    description: '相关文件路径，子 agent 会读取这些文件作为上下文',
                }),
            ),
            fallback: Type.Optional(
                Type.Boolean({
                    description: '失败时是否自动升级档位（默认 true）',
                    default: true,
                }),
            ),
        }),
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const { task, taskType, contextFiles, fallback = true } = params;
            const cwd = ctx.cwd;

            // 1. 确定推荐档位
            const recommendedTier = TASK_TIER_MAP[taskType] ?? 'medium';

            // 2. 加载档位配置并路由
            const tierConfig = loadTierConfig();
            let currentTierIdx = TIER_ORDER.indexOf(recommendedTier);

            const lines: string[] = [];
            lines.push(`🎯 任务路由：${taskType} → 推荐 ${recommendedTier} 档`);

            // 3. 尝试执行，失败自动 fallback
            while (currentTierIdx < TIER_ORDER.length) {
                const tier = TIER_ORDER[currentTierIdx];
                const { models, fallback: isFallback } = routeModel(tierConfig, tier);

                if (models.length === 0) {
                    lines.push(`⚠️ ${tier} 档无可用模型，尝试更高档...`);
                    currentTierIdx++;
                    continue;
                }

                const model = models[0];
                const isRetry = currentTierIdx > TIER_ORDER.indexOf(recommendedTier);

                lines.push(`${isRetry ? '🔄' : '🚀'} 使用 ${tier} 档模型：${model}`);

                if (onUpdate) {
                    onUpdate({
                        content: [{ type: 'text' as const, text: lines.join('\n') }],
                        details: {},
                    });
                }

                // 构建 agent 配置
                const agent: AgentConfig = {
                    name: `${taskType}任务执行员`,
                    description: `执行 ${taskType} 类型任务（${tier} 档模型）`,
                    model,
                    systemPrompt:
                        (TASK_PROMPT_MAP[taskType] ?? TASK_PROMPT_MAP.backend) +
                        (isRetry ? FALLBACK_PROMPT : ''),
                };

                // 构建任务：包含文件上下文
                let taskWithContext = task;
                if (contextFiles && contextFiles.length > 0) {
                    taskWithContext += `\n\n请读取以下文件作为上下文：\n${contextFiles.join('\n')}`;
                }

                // 执行
                const result = await runSingleAgent(cwd, agent, taskWithContext, {
                    signal,
                    heartbeatMs: 300_000,
                    maxHeartbeats: 2,
                    onUpdate: (agentName: string, chunk: string) => {
                        if (onUpdate) {
                            onUpdate({
                                content: [{ type: 'text' as const, text: `📝 ${agentName} 输出中...\n${chunk.slice(0, 500)}` }],
                                details: {},
                            });
                        }
                    },
                });

                // 4. 检查结果
                if (result.exitCode === 0 && !result.timedOut && result.stdout.trim()) {
                    // 成功
                    lines.push('');
                    lines.push('✅ 任务执行成功');
                    lines.push('');
                    lines.push(result.stdout);
                    if (result.stderr) {
                        lines.push('');
                        lines.push(`📋 日志：${result.stderr}`);
                    }
                    return ok(lines.join('\n'));
                }

                // 失败，记录原因
                lines.push(`❌ ${tier} 档执行失败：${result.timedOut ? '超时' : `退出码 ${result.exitCode}`}`);
                if (result.stderr) {
                    lines.push(`   stderr: ${result.stderr.slice(0, 300)}`);
                }

                if (!fallback) {
                    break;
                }

                // 自动 fallback
                currentTierIdx++;
                if (currentTierIdx < TIER_ORDER.length) {
                    lines.push(`⬆️ 自动升级到 ${TIER_ORDER[currentTierIdx]} 档重试...`);
                }
            }

            // 所有档位都失败
            lines.push('');
            lines.push('❌ 所有可用档位均执行失败。');
            lines.push('建议：');
            lines.push('1. 检查模型 API 配置是否正常');
            lines.push('2. 缩小任务范围（减少上下文文件）');
            lines.push('3. 手动使用 `raccoon_model_scan` 和 `raccoon_model_config` 配置模型档位');

            return fail(lines.join('\n'));
        },
    });
}
