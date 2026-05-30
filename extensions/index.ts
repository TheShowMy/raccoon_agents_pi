import { basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { VERSION } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import {
    type GitStatus,
    EMPTY_GIT_STATUS,
    isGitStatusClean,
    isGitWorkTree,
    readGitStatus as readGitStatusFromUtils,
} from './git-utils.js';
import { registerGitWorkflowTools } from './git-workflow.js';
import { registerProjectInfoTool } from './project-info.js';
import { installWorkflowUI } from './workflow-ui.js';
import { WORKFLOW_SYSTEM_PROMPT } from './workflow-prompt.js';


interface GitFooterController {
    scheduleRefresh(): void;
    dispose(): void;
}

interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

let guardStarted = false;
let gitFooterController: GitFooterController | undefined;


function headerLines(theme: Theme, width: number): string[] {
    const accent = (text: string) => theme.fg('accent', text);
    const muted = (text: string) => theme.fg('muted', text);
    const dim = (text: string) => theme.fg('dim', text);
    const border = (text: string) => theme.fg('borderAccent', text);

    const raccoon = [
        '    ╭─────────────────────────────────────╮',
        '    │                                     │',
        '    │   🦝  ' + theme.bold(accent('浣 熊 特 工 队')) + '            │',
        '    │       ' + muted('Raccoon Agents') + '  ' + dim(`v${VERSION}`) + '        │',
        '    │                                     │',
        '    │   Git 工作流自动化 · 模型档位路由    │',
        '    │                                     │',
        '    ╰─────────────────────────────────────╯',
        '',
    ];

    return raccoon.map((line) => truncateToWidth(line, width));
}

function installHeader(ctx: ExtensionContext) {
    ctx.ui.setTitle('浣熊特工队');
    ctx.ui.setHeader((_tui, theme) => ({
        render(width: number): string[] {
            return headerLines(theme, width);
        },
        invalidate() {},
    }));
}

function formatCwd(cwd: string): string {
    const home = process.env.HOME;
    if (home && cwd.startsWith(home)) {
        return `~${cwd.slice(home.length)}`;
    }
    return cwd;
}

function formatContextUsage(ctx: ExtensionContext): string {
    const usage = ctx.getContextUsage();
    const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
    if (!usage || usage.percent === null || !contextWindow) {
        return 'ctx ?';
    }
    return `ctx ${Math.round(usage.percent)}%/${Math.round(contextWindow / 1000)}k`;
}

function fitLine(left: string, right: string, width: number): string {
    if (width <= 0) return '';
    if (!right) return truncateToWidth(left, width);

    const minimumGap = 2;
    let leftText = left;
    let rightText = right;

    while (
        visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
        visibleWidth(rightText) > 18
    ) {
        rightText = truncateToWidth(rightText, visibleWidth(rightText) - 1, '');
    }
    while (
        visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
        visibleWidth(leftText) > 0
    ) {
        leftText = truncateToWidth(leftText, visibleWidth(leftText) - 1, '');
    }

    const gap = Math.max(1, width - visibleWidth(leftText) - visibleWidth(rightText));
    return truncateToWidth(`${leftText}${' '.repeat(gap)}${rightText}`, width);
}

function formatCommandError(label: string, result: CommandResult): string {
    const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
    return `${label} 执行失败，退出码 ${result.code}${detail ? `\n${detail}` : ''}`;
}


async function initializeGitRepository(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
    const confirmed = await ctx.ui.confirm(
        '初始化 Git 仓库？',
        `当前目录还不是 Git 项目：${formatCwd(ctx.cwd)}\n是否执行 git init 后进入对话？`,
    );
    if (!confirmed) {
        ctx.ui.setWidget('raccoon-git-required', [
            ctx.ui.theme.fg('warning', '当前目录不是 Git 项目'),
            '已取消初始化，浣熊特工队将退出。',
        ]);
        ctx.ui.notify('已取消 Git 初始化', 'warning');
        setTimeout(() => ctx.shutdown(), 250);
        return false;
    }

    const result = await pi.exec('git', ['init'], {
        cwd: ctx.cwd,
        timeout: 10_000,
    });
    if (result.code === 0) {
        ctx.ui.setWidget('raccoon-git-required', undefined);
        ctx.ui.notify('Git 仓库初始化完成', 'info');
        return true;
    }

    ctx.ui.setWidget('raccoon-git-required', [
        ctx.ui.theme.fg('error', 'Git 初始化失败'),
        ...formatCommandError('git init', result).split(/\r?\n/).slice(0, 8),
    ]);
    ctx.ui.notify('Git 初始化失败，已退出', 'error');
    setTimeout(() => ctx.shutdown(), 250);
    return false;
}


function renderGitSummary(theme: Theme, status: GitStatus): string {
    if (status.kind === 'loading') {
        return `${theme.fg('accent', 'Git')} ${theme.fg('muted', '加载中...')}`;
    }
    if (status.kind === 'not-git') {
        return `${theme.fg('warning', 'Git')} ${theme.fg('muted', '未初始化仓库')}`;
    }
    if (status.kind === 'error') {
        return `${theme.fg('error', 'Git 错误')} ${theme.fg('muted', status.error || '未知错误')}`;
    }

    const dirty = !isGitStatusClean(status);
    const branch = theme.bold(status.branch);
    const state = dirty ? theme.fg('warning', '有变更') : theme.fg('success', '干净');
    const syncParts: string[] = [];
    if (status.upstream) syncParts.push(theme.fg('muted', `上游 ${status.upstream}`));
    if (status.ahead > 0) syncParts.push(theme.fg('accent', `领先 ${status.ahead}`));
    if (status.behind > 0) syncParts.push(theme.fg('warning', `落后 ${status.behind}`));

    return [`${theme.fg('accent', 'Git')} ${branch}`, state, ...syncParts].join('  ');
}

function renderGitCounters(theme: Theme, status: GitStatus): string {
    if (status.kind !== 'ready') {
        return theme.fg('muted', '暂存 0  未暂存 0  未跟踪 0  冲突 0');
    }

    const color = status.conflicts > 0 ? 'error' : isGitStatusClean(status) ? 'success' : 'warning';
    return [
        theme.fg(color, `暂存 ${status.staged}`),
        theme.fg(color, `未暂存 ${status.unstaged}`),
        theme.fg(color, `未跟踪 ${status.untracked}`),
        theme.fg(status.conflicts > 0 ? 'error' : 'muted', `冲突 ${status.conflicts}`),
    ].join('  ');
}

function installGitFooter(pi: ExtensionAPI, ctx: ExtensionContext): GitFooterController {
    gitFooterController?.dispose();

    let status: GitStatus = { ...EMPTY_GIT_STATUS };
    let activeTui: TUI | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let pending = false;
    let disposed = false;

    const requestRender = () => activeTui?.requestRender();

    const refreshNow = async () => {
        if (disposed) return;
        if (inFlight) {
            pending = true;
            return;
        }

        inFlight = true;
        try {
            status = await readGitStatusFromUtils(pi, ctx.cwd);
        } catch (error) {
            status = {
                ...EMPTY_GIT_STATUS,
                kind: 'error',
                branch: 'git error',
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            inFlight = false;
            requestRender();
            if (pending) {
                pending = false;
                scheduleRefresh();
            }
        }
    };

    const scheduleRefresh = () => {
        if (disposed) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void refreshNow();
        }, 250);
    };

    class GitFooterPanel implements Component {
        private unsubscribeBranch: (() => void) | undefined;

        constructor(tui: TUI, unsubscribeBranch: () => void) {
            activeTui = tui;
            this.unsubscribeBranch = unsubscribeBranch;
        }

        render(width: number): string[] {
            const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : 'no model';
            const thinking = pi.getThinkingLevel();
            const project = basename(ctx.cwd) || formatCwd(ctx.cwd);
            const topLeft = renderGitSummary(ctx.ui.theme, status);
            const topRight = ctx.ui.theme.fg('dim', formatCwd(ctx.cwd));
            const bottomLeft = renderGitCounters(ctx.ui.theme, status);
            const bottomRight = ctx.ui.theme.fg(
                'dim',
                `${project}  ${model}  ${thinking}  ${formatContextUsage(ctx)}`,
            );

            return [fitLine(topLeft, topRight, width), fitLine(bottomLeft, bottomRight, width)];
        }

        invalidate(): void {}

        dispose(): void {
            this.unsubscribeBranch?.();
            this.unsubscribeBranch = undefined;
            if (activeTui) activeTui = undefined;
        }
    }

    ctx.ui.setFooter((tui, _theme, footerData) => {
        const unsubscribeBranch = footerData.onBranchChange(scheduleRefresh);
        return new GitFooterPanel(tui, unsubscribeBranch);
    });
    ctx.ui.setStatus('raccoon-agents', ctx.ui.theme.fg('accent', '浣熊特工队'));
    void refreshNow();

    const controller: GitFooterController = {
        scheduleRefresh,
        dispose() {
            disposed = true;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = undefined;
            activeTui = undefined;
            ctx.ui.setFooter(undefined);
            ctx.ui.setStatus('raccoon-agents', undefined);
        },
    };
    gitFooterController = controller;
    return controller;
}

async function ensureGitRepository(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
    if (await isGitWorkTree(pi, ctx.cwd)) return true;
    return initializeGitRepository(pi, ctx);
}

export default function raccoonAgents(pi: ExtensionAPI) {
    pi.on('tool_execution_end', () => {
        gitFooterController?.scheduleRefresh();
    });

    pi.on('turn_end', () => {
        gitFooterController?.scheduleRefresh();
    });

    pi.on('session_shutdown', () => {
        gitFooterController?.dispose();
        gitFooterController = undefined;
        guardStarted = false;
    });

    pi.on('session_start', async (_event, ctx) => {
        if (!ctx.hasUI) {
            console.error('浣熊特工队需要交互式 TUI 模式。');
            ctx.shutdown();
            return;
        }

        installHeader(ctx);
        installWorkflowUI(pi, ctx);

        // 注册工具（幂等，多次调用只有第一次生效）
        registerProjectInfoTool(pi);
        registerGitWorkflowTools(pi);

        if (guardStarted) return;
        guardStarted = true;

        try {
            if (!(await ensureGitRepository(pi, ctx))) return;
            installGitFooter(pi, ctx);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.setWidget('raccoon-git-required', [
                ctx.ui.theme.fg('error', 'Git 检查失败'),
                ...message.split(/\r?\n/).slice(0, 8),
            ]);
            ctx.ui.notify('Git 检查失败，已退出', 'error');
            setTimeout(() => ctx.shutdown(), 250);
            guardStarted = false;
        }
    });

    pi.on('before_agent_start', async (event) => {
        // 追加 Raccoon 工作流指导到 system prompt 末尾
        if (event.systemPrompt) {
            return { systemPrompt: `${event.systemPrompt}\n\n${WORKFLOW_SYSTEM_PROMPT}` };
        }
    });
}
