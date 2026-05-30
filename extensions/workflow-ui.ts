/**
 * 现代化工作流可视化 UI
 *
 * 提供：
 * 1. 工作流阶段进度条（编辑器上方 widget）—— 当前阶段 + 简洁进度条
 * 2. 并行任务面板（编辑器下方 widget）
 */

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

// ── 工作流阶段定义 ──────────────────────────────────────────────

export type WorkflowStep =
    | 'idle'
    | 'clarify'
    | 'issue'
    | 'branch'
    | 'code'
    | 'verify'
    | 'commit'
    | 'push'
    | 'pr-create'
    | 'review'
    | 'merge';

interface StepInfo {
    key: WorkflowStep;
    label: string;
    num: string;
}

const WORKFLOW_STEPS: StepInfo[] = [
    { key: 'clarify', label: '需求澄清', num: '1' },
    { key: 'issue', label: '创建 Issue', num: '2' },
    { key: 'branch', label: '创建分支', num: '3' },
    { key: 'code', label: '编码实现', num: '4' },
    { key: 'verify', label: '验证测试', num: '5' },
    { key: 'commit', label: '提交代码', num: '6' },
    { key: 'push', label: '推送分支', num: '7' },
    { key: 'pr-create', label: '创建 PR', num: '8' },
    { key: 'review', label: '代码审核', num: '9' },
    { key: 'merge', label: '合并代码', num: '10' },
];

// 工具名到阶段的映射
const TOOL_STEP_MAP: Record<string, WorkflowStep> = {
    raccoon_issue_create: 'issue',
    raccoon_issue_list: 'issue',
    raccoon_feature_new: 'branch',
    raccoon_git_commit: 'commit',
    raccoon_git_push: 'push',
    raccoon_pr_create: 'pr-create',
    raccoon_pr_review: 'review',
    raccoon_pr_merge: 'merge',
    raccoon_run_test: 'verify',
};

// ── 工作流状态管理 ──────────────────────────────────────────────

export interface ParallelTask {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    step: WorkflowStep;
    startTime: number;
    endTime?: number;
}

interface WorkflowState {
    currentStep: WorkflowStep;
    completedSteps: Set<WorkflowStep>;
    parallelTasks: ParallelTask[];
}

let workflowState: WorkflowState = {
    currentStep: 'idle',
    completedSteps: new Set(),
    parallelTasks: [],
};

let progressBarRef: WorkflowProgressBar | undefined;
let taskPanelRef: ParallelTaskPanel | undefined;
let tuiRef: TUI | undefined;

export function resetWorkflowState(): void {
    workflowState = {
        currentStep: 'idle',
        completedSteps: new Set(),
        parallelTasks: [],
    };
    progressBarRef?.invalidate();
    taskPanelRef?.invalidate();
    tuiRef?.requestRender();
}

export function advanceWorkflowStep(toolName: string): void {
    const step = TOOL_STEP_MAP[toolName];
    if (!step) return;

    if (workflowState.currentStep !== 'idle' && workflowState.currentStep !== step) {
        workflowState.completedSteps.add(workflowState.currentStep);
    }
    workflowState.currentStep = step;

    workflowState.parallelTasks.push({
        id: `${step}-${Date.now()}`,
        name: getStepLabel(step),
        status: 'running',
        step,
        startTime: Date.now(),
    });
    if (workflowState.parallelTasks.length > 20) {
        workflowState.parallelTasks = workflowState.parallelTasks.slice(-20);
    }

    progressBarRef?.invalidate();
    taskPanelRef?.invalidate();
    tuiRef?.requestRender();
}

export function completeTask(toolName: string, success: boolean): void {
    const step = TOOL_STEP_MAP[toolName];
    if (!step) return;

    for (let i = workflowState.parallelTasks.length - 1; i >= 0; i--) {
        const task = workflowState.parallelTasks[i];
        if (task.step === step && task.status === 'running') {
            task.status = success ? 'done' : 'error';
            task.endTime = Date.now();
            break;
        }
    }

    if (success && step !== 'merge') {
        workflowState.completedSteps.add(step);
    }

    progressBarRef?.invalidate();
    taskPanelRef?.invalidate();
    tuiRef?.requestRender();
}

/** 手动添加并行任务（用于 subagent 等嵌套任务） */
export function addParallelTask(name: string, step: WorkflowStep = 'code'): string {
    const id = `${step}-sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    workflowState.parallelTasks.push({
        id,
        name,
        status: 'running',
        step,
        startTime: Date.now(),
    });
    if (workflowState.parallelTasks.length > 20) {
        workflowState.parallelTasks = workflowState.parallelTasks.slice(-20);
    }
    progressBarRef?.invalidate();
    taskPanelRef?.invalidate();
    tuiRef?.requestRender();
    return id;
}

/** 手动完成并行任务 */
export function finishParallelTask(taskId: string, success: boolean): void {
    const task = workflowState.parallelTasks.find((t) => t.id === taskId);
    if (task) {
        task.status = success ? 'done' : 'error';
        task.endTime = Date.now();
        progressBarRef?.invalidate();
        taskPanelRef?.invalidate();
        tuiRef?.requestRender();
    }
}

function getStepLabel(step: WorkflowStep): string {
    const info = WORKFLOW_STEPS.find((s) => s.key === step);
    return info ? `[${info.num}] ${info.label}` : step;
}

// ── 进度条组件 ──────────────────────────────────────────────

class WorkflowProgressBar implements Component {
    private cachedWidth?: number;
    private cachedLines?: string[];

    render(width: number): string[] {
        if (this.cachedLines && this.cachedWidth === width) {
            return this.cachedLines;
        }
        const lines = this.build(width);
        this.cachedLines = lines;
        this.cachedWidth = width;
        return lines;
    }

    private build(width: number): string[] {
        const theme = globalTheme;
        if (!theme) return [];

        const steps = WORKFLOW_STEPS;
        const currentIdx = steps.findIndex((s) => s.key === workflowState.currentStep);
        if (currentIdx < 0) return [];

        const current = steps[currentIdx];
        const lines: string[] = [];
        lines.push('');

        // 当前阶段行
        const stepNum = theme.fg('accent', current.num);
        const stepName = theme.fg('accent', theme.bold(current.label));
        const currentLine = `  ▶ 当前阶段  ${stepNum}  ${stepName}`;
        lines.push(truncateToWidth(currentLine, width));

        // 简洁进度条：每个阶段一个字符块
        // 已完成: ━━━  当前: ▶━━  未开始: ┄┄┄
        const segWidth = Math.max(3, Math.floor((width - 8) / steps.length));
        const barParts: string[] = [];

        for (let i = 0; i < steps.length; i++) {
            const isDone = workflowState.completedSteps.has(steps[i].key);
            const isActive = i === currentIdx;

            if (isDone) {
                barParts.push(theme.fg('success', '━'.repeat(segWidth)));
            } else if (isActive) {
                barParts.push(theme.fg('accent', '▶' + '━'.repeat(segWidth - 1)));
            } else {
                barParts.push(theme.fg('dim', '┄'.repeat(segWidth)));
            }
        }

        const barLine = '  ' + barParts.join('');
        lines.push(truncateToWidth(barLine, width));
        lines.push('');

        return lines;
    }

    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}

// ── 并行任务面板组件 ──────────────────────────────────────────────

class ParallelTaskPanel implements Component {
    private cachedWidth?: number;
    private cachedLines?: string[];

    render(width: number): string[] {
        if (this.cachedLines && this.cachedWidth === width) {
            return this.cachedLines;
        }
        const lines = this.build(width);
        this.cachedLines = lines;
        this.cachedWidth = width;
        return lines;
    }

    private build(width: number): string[] {
        const theme = globalTheme;
        if (!theme) return [];

        const tasks = workflowState.parallelTasks.slice(-8);
        if (tasks.length === 0) return [];

        const lines: string[] = [];
        lines.push(theme.fg('borderMuted', '─'.repeat(width)));

        const running = tasks.filter((t) => t.status === 'running').length;
        const done = tasks.filter((t) => t.status === 'done').length;
        const error = tasks.filter((t) => t.status === 'error').length;

        const parts: string[] = [theme.bold('任务')];
        if (running > 0) parts.push(theme.fg('accent', `${running} 进行中`));
        if (done > 0) parts.push(theme.fg('success', `${done} 完成`));
        if (error > 0) parts.push(theme.fg('error', `${error} 失败`));
        lines.push(` ${parts.join('  |  ')}`);
        lines.push(theme.fg('borderMuted', '─'.repeat(width)));

        for (const task of tasks) {
            const icon =
                task.status === 'done' ? theme.fg('success', '✓')
                    : task.status === 'error' ? theme.fg('error', '✗')
                        : task.status === 'running' ? theme.fg('accent', '▶')
                            : theme.fg('dim', '○');

            const name = truncateToWidth(task.name, Math.max(16, width - 30));
            const dur = task.endTime
                ? `${((task.endTime - task.startTime) / 1000).toFixed(1)}s`
                : `${((Date.now() - task.startTime) / 1000).toFixed(1)}s`;

            const sc =
                task.status === 'done' ? 'success'
                    : task.status === 'error' ? 'error'
                        : task.status === 'running' ? 'accent'
                            : 'muted';
            const sl =
                task.status === 'running' ? '进行中'
                    : task.status === 'done' ? '完成'
                        : task.status === 'error' ? '失败' : '等待';

            const right = `${theme.fg('dim', dur)} ${theme.fg(sc, sl)}`;
            const gap = Math.max(1, width - visibleWidth(`  ${icon} ${name}  `) - visibleWidth(right));
            lines.push(`  ${icon} ${name}${' '.repeat(gap)}${right}`);
        }

        lines.push('');
        return lines.map((l) => truncateToWidth(l, width));
    }

    invalidate(): void {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}

// ── 全局主题引用 ──────────────────────────────────────────────

let globalTheme: Theme | undefined;

// ── 安装函数 ──────────────────────────────────────────────

export function installWorkflowUI(pi: ExtensionAPI, ctx: ExtensionContext): void {
    globalTheme = ctx.ui.theme;

    const progressBar = new WorkflowProgressBar();
    progressBarRef = progressBar;

    const taskPanel = new ParallelTaskPanel();
    taskPanelRef = taskPanel;

    // 1. 进度条 widget（编辑器上方）
    ctx.ui.setWidget('raccoon-workflow-progress', (tui, theme) => {
        tuiRef = tui;
        globalTheme = theme;
        return {
            render: (w: number) => progressBar.render(w),
            invalidate: () => progressBar.invalidate(),
        };
    });

    // 2. 任务面板 widget（编辑器下方）
    ctx.ui.setWidget(
        'raccoon-parallel-tasks',
        (tui, theme) => {
            tuiRef = tui;
            globalTheme = theme;
            return {
                render: (w: number) => taskPanel.render(w),
                invalidate: () => taskPanel.invalidate(),
            };
        },
        { placement: 'belowEditor' },
    );

    // 3. 监听工具执行
    pi.on('tool_execution_start', (event) => {
        advanceWorkflowStep(event.toolName);
    });

    pi.on('tool_execution_end', (event) => {
        completeTask(event.toolName, !event.isError);
    });

    // 4. 会话开始时重置
    pi.on('session_start', () => {
        resetWorkflowState();
    });
}
