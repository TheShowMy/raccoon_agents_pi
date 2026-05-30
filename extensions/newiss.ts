import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Raccoon Agents — /newiss 需求收集与 Issue 创建向导（LLM 协作版）
 *
 * 核心设计：
 * 1. LLM 分析用户需求，动态决定需要澄清什么
 * 2. LLM 输出 [CLARIFY] 标记块，包含追问问题和选项
 * 3. 扩展拦截标记块，用 TUI 选择器展示选项
 * 4. 用户选择后，答案发回 LLM 继续分析
 * 5. 直到 LLM 输出 [FINALIZE] 标记块，生成 Issue
 */

// ─── 状态管理 ───────────────────────────────────────────────────────────────

interface Clarification {
    question: string;
    answer: string;
}

interface IssueDraft {
    feature: string;
    clarifications: Clarification[];
}

interface FinalIssue {
    title: string;
    body: string;
}

interface NewissState {
    phase: 'idle' | 'collecting' | 'confirming';
    draft: IssueDraft | null;
    finalIssue: FinalIssue | null;
}

const state: NewissState = {
    phase: 'idle',
    draft: null,
    finalIssue: null,
};

function resetState() {
    state.phase = 'idle';
    state.draft = null;
    state.finalIssue = null;
}

function startCollecting(feature: string) {
    state.phase = 'collecting';
    state.draft = {
        feature,
        clarifications: [],
    };
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function extractTextFromMessage(message: any): string {
    if (!message.content || !Array.isArray(message.content)) return '';
    return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
}

interface ClarifyData {
    question: string;
    options: string[];
    allowCustom: boolean;
}

interface FinalizeData {
    title: string;
    body: string;
}

function extractClarify(text: string): ClarifyData | null {
    const match = text.match(/\[CLARIFY\]\s*\n?([\s\S]*?)\n?\[\/CLARIFY\]/);
    if (!match) return null;
    try {
        const data = JSON.parse(match[1].trim());
        return {
            question: data.question || '',
            options: Array.isArray(data.options) ? data.options : [],
            allowCustom: data.allowCustom !== false,
        };
    } catch {
        return null;
    }
}

function extractFinalize(text: string): FinalizeData | null {
    const match = text.match(/\[FINALIZE\]\s*\n?([\s\S]*?)\n?\[\/FINALIZE\]/);
    if (!match) return null;
    try {
        const data = JSON.parse(match[1].trim());
        return {
            title: data.title || '',
            body: data.body || '',
        };
    } catch {
        return null;
    }
}

// ─── Issue 创建 ─────────────────────────────────────────────────────────────

async function createGitIssue(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    title: string,
    body: string,
): Promise<void> {
    ctx.ui.setStatus('newiss', '正在创建 Issue...');
    try {
        const result = await pi.exec('gh', ['issue', 'create', '--title', title, '--body', body], {
            cwd: ctx.cwd,
            timeout: 15_000,
        });
        if (result.code === 0) {
            const url = result.stdout.trim();
            ctx.ui.notify(`✅ Issue 已创建！${url}`, 'info');
            ctx.ui.setWidget('newiss-result', ['', '🎉 Issue 创建成功！', url, '']);
        } else {
            ctx.ui.notify(`创建失败：${result.stderr.slice(0, 200)}`, 'error');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`创建异常：${msg}`, 'error');
    } finally {
        ctx.ui.setStatus('newiss', undefined);
        resetState();
    }
}

// ─── 主注册 ─────────────────────────────────────────────────────────────────

export function registerNewiss(pi: ExtensionAPI) {
    // 注册 /newiss 命令
    pi.registerCommand('newiss', {
        description: '🦝 收集需求并创建 Git Issue',
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify('newiss 需要交互式 TUI 模式', 'error');
                return;
            }

            if (state.phase === 'collecting') {
                ctx.ui.notify('已有进行中的需求收集，请继续完成或按 Esc 取消', 'warning');
                return;
            }

            const feature = await ctx.ui.input('🦝 想做什么？一句话描述：');
            if (!feature) {
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            startCollecting(feature.trim());
            ctx.ui.notify('已进入需求收集模式，浣熊正在分析你的需求...', 'info');

            // 触发 LLM 分析需求
            pi.sendUserMessage(feature.trim());
        },
    });

    // 注入系统提示，引导 LLM 行为
    pi.on('before_agent_start', async (event, _ctx) => {
        if (state.phase !== 'collecting' || !state.draft) return;

        const draft = state.draft;
        const collected =
            draft.clarifications.length > 0
                ? draft.clarifications.map((c) => `  - ${c.question}：${c.answer}`).join('\n')
                : '  （暂无）';

        const prompt = `
【系统指令】你正在协助用户使用 /newiss 功能收集需求并创建 GitHub Issue。

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
分析当前信息是否足够创建清晰的 Issue。如果缺少关键信息（如具体场景、验收标准、技术约束），输出 CLARIFY 追问。如果信息足够，输出 FINALIZE 生成 Issue。
`.trim();

        return {
            systemPrompt: event.systemPrompt + '\n\n' + prompt,
        };
    });

    // 拦截 LLM 回复，解析标记块
    pi.on('message_end', async (event, ctx) => {
        if (event.message.role !== 'assistant') return;
        if (state.phase !== 'collecting' || !state.draft) return;

        const text = extractTextFromMessage(event.message);

        // ─── 处理 CLARIFY ───
        const clarify = extractClarify(text);
        if (clarify) {
            const options = [...clarify.options];
            if (clarify.allowCustom !== false) {
                options.push('📝 自由描述...');
            }

            const choice = await ctx.ui.select(clarify.question, options);

            if (choice === undefined || choice === null) {
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: '❌ 已取消需求收集' }],
                    },
                };
            }

            const idx = typeof choice === 'string' ? parseInt(choice, 10) : choice;
            if (isNaN(idx)) {
                resetState();
                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: '❌ 已取消需求收集' }],
                    },
                };
            }

            let answer: string;
            const isCustomOption = clarify.allowCustom !== false && idx === options.length - 1;
            if (isCustomOption) {
                const custom = await ctx.ui.input('请描述：');
                answer = custom || '未指定';
            } else {
                answer = clarify.options[idx] || '未指定';
            }

            // 记录答案
            state.draft.clarifications.push({
                question: clarify.question,
                answer,
            });

            // 发送答案触发下一轮 LLM 分析
            pi.sendUserMessage(answer);

            // 替换原始消息为简化提示
            return {
                message: {
                    ...event.message,
                    content: [{ type: 'text', text: `🦝 ${clarify.question}` }],
                },
            };
        }

        // ─── 处理 FINALIZE ───
        const finalize = extractFinalize(text);
        if (finalize) {
            state.phase = 'confirming';
            state.finalIssue = finalize;

            // 展示确认面板
            const summaryLines = [
                '',
                '┌──────────────────────────────────────────────────────────┐',
                '│  📋 Issue 预览                                           │',
                '├──────────────────────────────────────────────────────────┤',
                `│  标题：${finalize.title.slice(0, 46).padEnd(46)}│`,
                '│                                                          │',
                '│  正文预览：                                              │',
            ];

            const bodyLines = finalize.body.split('\n');
            const previewLines = bodyLines.slice(0, 6);
            previewLines.forEach((line) => {
                const truncated = line.slice(0, 50);
                summaryLines.push(`│  ${truncated.padEnd(54)}│`);
            });
            if (bodyLines.length > 6) {
                summaryLines.push(`│  ...${' '.repeat(51)}│`);
            }

            summaryLines.push('└──────────────────────────────────────────────────────────┘');
            summaryLines.push('');

            ctx.ui.setWidget('newiss-summary', summaryLines);

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
            if (isNaN(idx)) {
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: '❌ 已取消' }],
                    },
                };
            }

            if (idx === 2) {
                // 取消
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
                // 补充信息：回到收集模式
                state.phase = 'collecting';
                ctx.ui.notify('请继续描述你想补充的内容', 'info');
                return {
                    message: {
                        ...event.message,
                        content: [{ type: 'text', text: '📝 请补充更多信息' }],
                    },
                };
            }

            // 创建 Issue
            await createGitIssue(pi, ctx, finalize.title, finalize.body);

            return {
                message: {
                    ...event.message,
                    content: [{ type: 'text', text: '✅ Issue 创建完成！' }],
                },
            };
        }

        // 没有检测到标记块，正常显示原始消息
    });

    // session 结束时清理状态
    pi.on('session_shutdown', () => {
        resetState();
    });
}
