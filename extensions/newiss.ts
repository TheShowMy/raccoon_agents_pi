import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Raccoon Agents — /newiss 需求收集与 Issue 创建向导
 *
 * 设计原则：
 * 1. LLM 参与：通过 before_agent_start 注入需求上下文，让 LLM 自然参与追问
 * 2. 灵活交互：每个追问都提供预设选项 + 自由输入，不强制选择
 * 3. 通用维度：不硬编码场景（如登录/支付），而是基于通用的需求维度收集
 */

// ─── 状态管理 ───────────────────────────────────────────────────────────────

interface RequirementDraft {
    feature: string;
    who: string;
    what: string;
    why: string;
    acceptance: string[];
    constraints: string[];
    notes: string[];
}

let activeDraft: RequirementDraft | null = null;
let newissPhase: 'idle' | 'collecting' | 'confirming' = 'idle';

function resetState() {
    activeDraft = null;
    newissPhase = 'idle';
}

function startDraft(feature: string): RequirementDraft {
    const draft: RequirementDraft = {
        feature,
        who: '',
        what: '',
        why: '',
        acceptance: [],
        constraints: [],
        notes: [],
    };
    activeDraft = draft;
    newissPhase = 'collecting';
    return draft;
}

// ─── Issue 生成 ─────────────────────────────────────────────────────────────

function buildIssueBody(draft: RequirementDraft): string {
    const lines: string[] = [];

    lines.push('## 功能概述');
    lines.push(draft.feature);
    lines.push('');

    if (draft.who || draft.what || draft.why) {
        lines.push('## 需求背景');
        if (draft.who) lines.push(`- **为谁做**：${draft.who}`);
        if (draft.what) lines.push(`- **做什么**：${draft.what}`);
        if (draft.why) lines.push(`- **为什么做**：${draft.why}`);
        lines.push('');
    }

    if (draft.acceptance.length > 0) {
        lines.push('## 验收标准');
        draft.acceptance.forEach((item) => {
            lines.push(`- [ ] ${item}`);
        });
        lines.push('');
    }

    if (draft.constraints.length > 0) {
        lines.push('## 约束与边界');
        draft.constraints.forEach((c) => lines.push(`- ${c}`));
        lines.push('');
    }

    if (draft.notes.length > 0) {
        lines.push('## 补充说明');
        draft.notes.forEach((n) => lines.push(`- ${n}`));
        lines.push('');
    }

    lines.push('---');
    lines.push('*由 Raccoon Agents（浣熊特工队）协助创建* 🦝');

    return lines.join('\n');
}

function buildIssueTitle(draft: RequirementDraft): string {
    const prefix = draft.feature.length > 40 ? draft.feature.slice(0, 37) + '...' : draft.feature;
    return `feat: ${prefix}`;
}

function formatSummary(draft: RequirementDraft): string[] {
    const lines: string[] = [''];
    lines.push('┌──────────────────────────────────────────────────────────┐');
    lines.push('│  📋 需求草稿                                              │');
    lines.push('├──────────────────────────────────────────────────────────┤');

    const feature = draft.feature.length > 46 ? draft.feature.slice(0, 43) + '...' : draft.feature;
    lines.push(`│  功能：${feature.padEnd(46)}│`);

    if (draft.who) {
        const text = draft.who.length > 46 ? draft.who.slice(0, 43) + '...' : draft.who;
        lines.push(`│  对象：${text.padEnd(46)}│`);
    }
    if (draft.why) {
        const text = draft.why.length > 46 ? draft.why.slice(0, 43) + '...' : draft.why;
        lines.push(`│  价值：${text.padEnd(46)}│`);
    }
    if (draft.acceptance.length > 0) {
        lines.push(`│  验收：${draft.acceptance[0].padEnd(46)}│`);
        draft.acceptance.slice(1).forEach((a) => {
            const text = a.length > 46 ? a.slice(0, 43) + '...' : a;
            lines.push(`│        ${text.padEnd(46)}│`);
        });
    }
    if (draft.constraints.length > 0) {
        lines.push(`│  约束：${draft.constraints[0].padEnd(46)}│`);
    }

    lines.push('└──────────────────────────────────────────────────────────┘');
    lines.push('');
    return lines;
}

// ─── TUI 交互 ───────────────────────────────────────────────────────────────

async function askOptionOrInput(
    ctx: ExtensionContext,
    question: string,
    options: string[],
): Promise<string | null> {
    const items = [...options, '📝 自由描述...'];
    const choice = await ctx.ui.select(question, items);
    if (choice === undefined || choice === null) return null;

    const idx = typeof choice === 'string' ? parseInt(choice, 10) : choice;
    if (isNaN(idx)) return null;

    // 最后一项是自由输入
    if (idx === items.length - 1) {
        const custom = await ctx.ui.input('请描述：');
        return custom ?? null;
    }

    return options[idx] ?? null;
}

async function askMultipleWithCustom(
    ctx: ExtensionContext,
    question: string,
    options: string[],
): Promise<string[] | null> {
    const result: string[] = [];
    const remaining = [...options];

    while (remaining.length > 0) {
        const items = [...remaining, '📝 自由添加...', '✅ 完成'];
        const choice = await ctx.ui.select(`${question}（已选 ${result.length} 项）`, items);

        if (choice === undefined || choice === null) return null;
        const idx = typeof choice === 'string' ? parseInt(choice, 10) : choice;
        if (isNaN(idx)) return null;

        if (idx === items.length - 1) break; // 完成
        if (idx === items.length - 2) {
            // 自由添加
            const custom = await ctx.ui.input('请描述验收标准：');
            if (custom) result.push(custom);
            continue;
        }

        result.push(remaining[idx]);
        remaining.splice(idx, 1);
    }

    return result;
}

// ─── 需求收集流程 ───────────────────────────────────────────────────────────

async function collectRequirements(ctx: ExtensionContext): Promise<boolean> {
    const draft = activeDraft;
    if (!draft) return false;

    // 1. 为谁做？
    if (!draft.who) {
        const answer = await askOptionOrInput(ctx, '这个功能主要给谁用？', [
            '终端用户（C端）',
            '管理员/运营（B端）',
            '开发者/内部',
        ]);
        if (answer === null) return false;
        draft.who = answer;
    }

    // 2. 解决什么问题？
    if (!draft.why) {
        const answer = await askOptionOrInput(ctx, '为什么要做这个？解决了什么痛点？', [
            '用户反馈的高频需求',
            '现有功能的体验优化',
            '技术债务/架构改进',
            '新业务场景需要',
        ]);
        if (answer === null) return false;
        draft.why = answer;
    }

    // 3. 验收标准
    if (draft.acceptance.length === 0) {
        const answers = await askMultipleWithCustom(ctx, '怎么算做好了？', [
            '功能可正常使用，核心流程跑通',
            '异常场景有处理，用户有反馈',
            '已编写并运行测试用例',
            '代码通过 Code Review',
            '已更新相关文档',
        ]);
        if (answers === null) return false;
        draft.acceptance = answers;
    }

    // 4. 约束条件（可选）
    const hasConstraints = await ctx.ui.confirm(
        '有没有技术或业务约束？',
        '比如兼容特定浏览器、性能要求、依赖第三方服务等',
    );
    if (hasConstraints) {
        const answers = await askMultipleWithCustom(ctx, '有哪些约束？', [
            '兼容主流浏览器（Chrome/Safari/Firefox）',
            '移动端优先适配',
            '响应时间 < 200ms',
            '不能破坏现有 API 兼容性',
        ]);
        if (answers !== null) {
            draft.constraints = answers;
        }
    }

    // 5. 补充说明（可选）
    const hasNotes = await ctx.ui.confirm(
        '还有需要补充的吗？',
        '任何设计参考、竞品对标、优先级说明等',
    );
    if (hasNotes) {
        const note = await ctx.ui.input('请补充（直接回车结束）：');
        if (note) draft.notes.push(note);
    }

    return true;
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

            // 如果正在收集中，展示当前状态
            if (newissPhase === 'collecting' && activeDraft) {
                const summary = formatSummary(activeDraft);
                ctx.ui.setWidget('newiss-summary', summary);
                ctx.ui.notify('当前有进行中的需求收集，继续完善或创建 Issue', 'info');
                return;
            }

            // 第一步：收集功能描述
            const feature = await ctx.ui.input('🦝 想做什么？一句话描述：');
            if (!feature) {
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            startDraft(feature.trim());

            // 进入多轮收集
            const ok = await collectRequirements(ctx);
            if (!ok) {
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                ctx.ui.notify('已取消需求收集', 'warning');
                return;
            }

            // 展示摘要
            newissPhase = 'confirming';
            const summary = formatSummary(activeDraft!);
            ctx.ui.setWidget('newiss-summary', summary);

            // 最终确认
            const action = await ctx.ui.select('需求已整理完毕，请选择：', [
                '✅ 直接创建 Issue',
                '📝 补充更多信息',
                '❌ 取消',
            ]);

            if (action === undefined || action === null) {
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            const idx = typeof action === 'string' ? parseInt(action, 10) : action;
            if (isNaN(idx)) {
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            if (idx === 2) {
                // 取消
                resetState();
                ctx.ui.setWidget('newiss-summary', undefined);
                ctx.ui.notify('已取消', 'warning');
                return;
            }

            if (idx === 1) {
                // 补充信息 — 让用户自由与 LLM 讨论
                ctx.ui.notify('请直接描述你想补充的内容，浣熊会帮你整合', 'info');
                // 保持状态，用户可以继续对话
                return;
            }

            // 创建 Issue
            await createIssue(pi, ctx);
        },
    });

    // 监听 before_agent_start，注入需求上下文让 LLM 参与
    pi.on('before_agent_start', async (event, ctx) => {
        if (newissPhase !== 'collecting' && newissPhase !== 'confirming') return;
        if (!activeDraft) return;

        const draft = activeDraft;
        const contextLines: string[] = [];
        contextLines.push('【当前正在使用 /newiss 收集需求，请基于以下信息协助用户完善】');
        contextLines.push(`功能概述：${draft.feature}`);
        if (draft.who) contextLines.push(`目标用户：${draft.who}`);
        if (draft.why) contextLines.push(`需求价值：${draft.why}`);
        if (draft.acceptance.length > 0) {
            contextLines.push(`验收标准：${draft.acceptance.join('；')}`);
        }
        if (draft.constraints.length > 0) {
            contextLines.push(`约束条件：${draft.constraints.join('；')}`);
        }
        contextLines.push('');
        contextLines.push(
            "提示：如果用户补充了新信息，请帮助梳理并整合到需求中。用户可以说'好了'来结束收集。",
        );

        return {
            systemPrompt: event.systemPrompt + '\n\n' + contextLines.join('\n'),
        };
    });

    // 监听 input，检测用户是否说"好了"来触发 Issue 创建
    pi.on('input', async (event, ctx) => {
        if (newissPhase !== 'confirming' || !activeDraft) return;

        const text = event.text.trim().toLowerCase();
        if (text === '好了' || text === '创建' || text === '创建issue' || text === '/newiss') {
            // 用户确认创建
            await createIssue(pi, ctx);
            return { action: 'handled' };
        }

        // 其他输入让 LLM 正常处理，before_agent_start 会注入上下文
        return { action: 'continue' };
    });

    // session 结束时清理状态
    pi.on('session_shutdown', () => {
        resetState();
    });
}

// ─── Issue 创建 ─────────────────────────────────────────────────────────────

async function createIssue(pi: ExtensionAPI, ctx: ExtensionContext) {
    if (!activeDraft) return;

    ctx.ui.setStatus('newiss', '正在创建 Issue...');

    try {
        const draft = activeDraft;
        const title = buildIssueTitle(draft);
        const body = buildIssueBody(draft);

        const result = await pi.exec('gh', ['issue', 'create', '--title', title, '--body', body], {
            cwd: ctx.cwd,
            timeout: 15_000,
        });

        if (result.code === 0) {
            const url = result.stdout.trim();
            ctx.ui.notify(`✅ Issue 已创建！${url}`, 'info');
            ctx.ui.setWidget('newiss-summary', ['', '🎉 Issue 创建成功！', `${url}`, '']);
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
