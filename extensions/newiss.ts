import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Raccoon Agents — /newiss 需求收集、Issue 创建与任务规划
 *
 * 完整流程：
 * /newiss → 用户描述需求 → LLM 多轮追问（CLARIFY）→ LLM 生成 Issue（FINALIZE）
 *        → 用户确认 → 创建 Issue → 自动触发规划 → LLM 拆分任务（PLAN）
 *        → 用户确认 → 开始自动开发
 */

// ─── 类型与状态 ─────────────────────────────────────────────────────────────

interface Clarification {
    question: string;
    answer: string;
}

interface IssueDraft {
    feature: string;
    clarifications: Clarification[];
}

interface TaskPlan {
    id: number;
    title: string;
    description: string;
    model: string;
}

interface NewissState {
    phase: 'idle' | 'collecting' | 'confirming' | 'planning';
    draft: IssueDraft | null;
    issueUrl: string | null;
    issueTitle: string | null;
    issueBody: string | null;
    plan: TaskPlan[] | null;
}

const state: NewissState = {
    phase: 'idle',
    draft: null,
    issueUrl: null,
    issueTitle: null,
    issueBody: null,
    plan: null,
};

function resetState() {
    state.phase = 'idle';
    state.draft = null;
    state.issueUrl = null;
    state.issueTitle = null;
    state.issueBody = null;
    state.plan = null;
}

function startCollecting(feature: string) {
    state.phase = 'collecting';
    state.draft = { feature, clarifications: [] };
}

function setIssueCreated(url: string, title: string, body: string) {
    state.issueUrl = url;
    state.issueTitle = title;
    state.issueBody = body;
    state.phase = 'planning';
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function extractTextFromMessage(message: any): string {
    if (!message.content || !Array.isArray(message.content)) return '';
    return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
}

function extractTag(text: string, tag: string): string | null {
    const regex = new RegExp(`\\[${tag}\\]\\s*\\n?([\\s\\S]*?)\\n?\\[\\/${tag}\\]`);
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}

// ─── Issue 创建 ─────────────────────────────────────────────────────────────

async function createGitIssue(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    title: string,
    body: string,
): Promise<string | null> {
    ctx.ui.setStatus('newiss', '正在创建 Issue...');
    try {
        const result = await pi.exec('gh', ['issue', 'create', '--title', title, '--body', body], {
            cwd: ctx.cwd,
            timeout: 15_000,
        });
        if (result.code === 0) {
            const url = result.stdout.trim();
            ctx.ui.notify(`✅ Issue 已创建！${url}`, 'info');
            return url;
        } else {
            ctx.ui.notify(`创建失败：${result.stderr.slice(0, 200)}`, 'error');
            return null;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`创建异常：${msg}`, 'error');
        return null;
    } finally {
        ctx.ui.setStatus('newiss', undefined);
    }
}

// ─── 系统提示注入 ───────────────────────────────────────────────────────────

function buildCollectingPrompt(draft: IssueDraft): string {
    const collected =
        draft.clarifications.length > 0
            ? draft.clarifications.map((c) => `  - ${c.question}：${c.answer}`).join('\n')
            : '  （暂无）';

    return `
【系统指令】你正在协助用户使用 /newiss 收集需求并创建 GitHub Issue。

【输出规则 — 严格遵守】
1. 每次回复必须且只能包含一个标记块
2. 不要输出任何解释性文字、分析、问候语或 Markdown
3. 只输出纯标记块，不要带代码围栏

【标记格式】
需要追问时：
[CLARIFY]
{"question":"追问问题","options":["选项1","选项2","选项3"],"allowCustom":true}
[/CLARIFY]

信息足够时：
[FINALIZE]
{"title":"feat: 简短标题","body":"## 功能描述\\n...\\n\\n## 验收标准\\n- [ ] ..."}
[/FINALIZE]

【已收集的需求信息】
功能概述：${draft.feature}
已澄清：
${collected}

【你的任务】
分析当前信息是否足够创建清晰的 Issue。如果缺少关键信息（如具体场景、验收标准、技术约束），输出 CLARIFY 追问。如果信息足够，输出 FINALIZE 生成 Issue。不要输出任何标记块之外的内容。
`.trim();
}

function buildPlanningPrompt(title: string, body: string): string {
    return `
【系统指令】你是浣熊特工队的任务规划专家。Issue 已创建，现在需要根据 Issue 内容拆分开发任务。

【输出规则 — 严格遵守】
1. 每次回复必须且只能包含一个标记块
2. 不要输出任何解释性文字、分析、问候语或 Markdown
3. 只输出纯标记块，不要带代码围栏

【标记格式】
[PLAN]
{"tasks":[{"id":1,"title":"任务标题","description":"具体做什么","model":"建议的模型档位(high/medium/low)"}]}
[/PLAN]

【已创建的 Issue】
标题：${title}

正文：
${body}

【你的任务】
分析上述 Issue，将其拆分为 2-5 个可并行的开发子任务。每个任务指定建议的模型档位：
- high：需要复杂推理（架构设计、疑难算法）
- medium：标准开发任务（常规功能实现）
- low：简单任务（配置修改、文档更新）

只输出 PLAN 标记块，不要输出其他内容。
`.trim();
}

// ─── 主注册 ─────────────────────────────────────────────────────────────────

export function registerNewiss(pi: ExtensionAPI) {
    // 注册 /newiss 命令
    pi.registerCommand('newiss', {
        description: '🦝 收集需求、创建 Issue 并自动规划拆分任务',
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify('newiss 需要交互式 TUI 模式', 'error');
                return;
            }

            if (state.phase !== 'idle') {
                ctx.ui.notify('已有进行中的需求收集，请继续完成或取消', 'warning');
                return;
            }

            const feature = await ctx.ui.input('🦝 想做什么？一句话描述：');
            if (!feature) {
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            startCollecting(feature.trim());
            ctx.ui.notify('🦝 浣熊正在分析你的需求...', 'info');
            pi.sendUserMessage(feature.trim());
        },
    });

    // 系统提示注入
    pi.on('before_agent_start', async (event, _ctx) => {
        if (state.phase === 'collecting' && state.draft) {
            return {
                systemPrompt: event.systemPrompt + '\n\n' + buildCollectingPrompt(state.draft),
            };
        }
        if (state.phase === 'planning' && state.issueTitle && state.issueBody) {
            return {
                systemPrompt:
                    event.systemPrompt +
                    '\n\n' +
                    buildPlanningPrompt(state.issueTitle, state.issueBody),
            };
        }
    });

    // 拦截 LLM 回复
    pi.on('message_end', async (event, ctx) => {
        if (event.message.role !== 'assistant') return;

        const text = extractTextFromMessage(event.message);

        // ═══ 阶段一：收集需求（CLARIFY / FINALIZE）═══════════════════
        if (state.phase === 'collecting' && state.draft) {
            // 处理 CLARIFY
            const clarifyRaw = extractTag(text, 'CLARIFY');
            if (clarifyRaw) {
                let data: any;
                try {
                    data = JSON.parse(clarifyRaw);
                } catch {
                    return;
                }

                const options: string[] = Array.isArray(data.options) ? data.options : [];
                if (data.allowCustom !== false) {
                    options.push('📝 自由描述...');
                }

                const choice = await ctx.ui.select(data.question || '请补充信息：', options);
                if (choice === undefined || choice === null) {
                    resetState();
                    ctx.ui.setWidget('newiss-summary', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                const idx = typeof choice === 'string' ? parseInt(choice, 10) : choice;
                if (isNaN(idx)) {
                    resetState();
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                const isCustom = data.allowCustom !== false && idx === options.length - 1;
                let answer: string;
                if (isCustom) {
                    const custom = await ctx.ui.input('请描述：');
                    answer = custom || '未指定';
                } else {
                    answer = data.options[idx] || '未指定';
                }

                state.draft.clarifications.push({
                    question: data.question,
                    answer,
                });

                pi.sendUserMessage(answer);
                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: `🦝 ${data.question}` }],
                    },
                };
            }

            // 处理 FINALIZE
            const finalizeRaw = extractTag(text, 'FINALIZE');
            if (finalizeRaw) {
                let data: any;
                try {
                    data = JSON.parse(finalizeRaw);
                } catch {
                    return;
                }

                state.phase = 'confirming';

                const title = data.title || 'feat: 未命名功能';
                const body = data.body || '';

                const summary = [
                    '',
                    '┌──────────────────────────────────────────────────────────┐',
                    '│  📋 Issue 预览                                           │',
                    '├──────────────────────────────────────────────────────────┤',
                    `│  标题：${title.slice(0, 46).padEnd(46)}│`,
                    '│                                                          │',
                    '│  正文预览：                                              │',
                    ...body
                        .split('\n')
                        .slice(0, 6)
                        .map((l: string) => `│  ${l.slice(0, 50).padEnd(54)}│`),
                    ...(body.split('\n').length > 6 ? [`│  ...${' '.repeat(51)}│`] : []),
                    '└──────────────────────────────────────────────────────────┘',
                    '',
                ];
                ctx.ui.setWidget('newiss-summary', summary);

                const action = await ctx.ui.select('确认创建 Issue？', [
                    '✅ 直接创建',
                    '📝 再补充点信息',
                    '❌ 取消',
                ]);

                if (action === undefined || action === null) {
                    resetState();
                    ctx.ui.setWidget('newiss-summary', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                const idx = typeof action === 'string' ? parseInt(action, 10) : action;
                if (isNaN(idx) || idx === 2) {
                    resetState();
                    ctx.ui.setWidget('newiss-summary', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                if (idx === 1) {
                    state.phase = 'collecting';
                    ctx.ui.notify('📝 请继续描述你想补充的内容', 'info');
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '📝 请补充更多信息' }],
                        },
                    };
                }

                // 创建 Issue
                const url = await createGitIssue(pi, ctx, title, body);
                if (!url) {
                    resetState();
                    ctx.ui.setWidget('newiss-summary', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ Issue 创建失败' }],
                        },
                    };
                }

                // 自动触发任务规划
                setIssueCreated(url, title, body);
                ctx.ui.notify('🦝 Issue 创建成功！正在自动规划任务拆分...', 'info');
                pi.sendUserMessage('开始规划任务拆分');

                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: `✅ Issue 已创建：${url}` }],
                    },
                };
            }
        }

        // ═══ 阶段二：任务规划（PLAN）═══════════════════════════════
        if (state.phase === 'planning' && state.issueTitle && state.issueBody) {
            const planRaw = extractTag(text, 'PLAN');
            if (planRaw) {
                let data: any;
                try {
                    data = JSON.parse(planRaw);
                } catch {
                    return;
                }

                const tasks: TaskPlan[] = Array.isArray(data.tasks)
                    ? data.tasks.map((t: any) => ({
                          id: t.id || 0,
                          title: t.title || '未命名任务',
                          description: t.description || '',
                          model: t.model || 'medium',
                      }))
                    : [];

                state.plan = tasks;

                // 展示任务计划
                const planLines = [
                    '',
                    '┌──────────────────────────────────────────────────────────┐',
                    '│  📋 任务拆分计划                                         │',
                    '├──────────────────────────────────────────────────────────┤',
                ];

                tasks.forEach((task) => {
                    const modelEmoji =
                        task.model === 'high' ? '🔴' : task.model === 'medium' ? '🟡' : '🟢';
                    const title = task.title.slice(0, 44).padEnd(44);
                    planLines.push(`│  ${task.id}. ${title}${modelEmoji} │`);
                    const desc = task.description.slice(0, 48).padEnd(48);
                    planLines.push(`│     ${desc}│`);
                });

                planLines.push('├──────────────────────────────────────────────────────────┤');
                planLines.push('│  🔴 高档(high)  🟡 中档(medium)  🟢 低档(low)          │');
                planLines.push('└──────────────────────────────────────────────────────────┘');
                planLines.push('');

                ctx.ui.setWidget('newiss-plan', planLines);

                const action = await ctx.ui.select('确认开始自动开发？', [
                    '🚀 开始执行',
                    '📝 调整任务计划',
                    '❌ 取消',
                ]);

                if (action === undefined || action === null) {
                    resetState();
                    ctx.ui.setWidget('newiss-plan', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                const idx = typeof action === 'string' ? parseInt(action, 10) : action;
                if (isNaN(idx) || idx === 2) {
                    resetState();
                    ctx.ui.setWidget('newiss-plan', undefined);
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '❌ 已取消' }],
                        },
                    };
                }

                if (idx === 1) {
                    // 调整任务：让用户自由输入调整意见
                    ctx.ui.notify('📝 请描述你想如何调整任务计划', 'info');
                    return {
                        message: {
                            ...event.message,
                            content: [{ type: 'text', text: '📝 请描述调整意见' }],
                        },
                    };
                }

                // 开始执行
                ctx.ui.setWidget('newiss-plan', undefined);
                ctx.ui.notify('🚀 任务计划已确认！浣熊特工队开始自动开发...', 'info');

                // TODO: 启动多模型 Agent 编排开发流程
                // 这里可以发送消息触发后续开发流程
                const taskSummary = tasks.map((t) => `${t.id}. [${t.model}] ${t.title}`).join('\n');

                resetState();
                return {
                    message: {
                        ...event.message,
                        content: [
                            {
                                type: 'text',
                                text: `🚀 任务计划已确认！开始执行以下 ${tasks.length} 个子任务：\n\n${taskSummary}\n\n（开发编排功能开发中，后续版本将实现自动分配模型并行开发）`,
                            },
                        ],
                    },
                };
            }
        }
    });

    // session 结束清理
    pi.on('session_shutdown', () => {
        resetState();
    });
}
