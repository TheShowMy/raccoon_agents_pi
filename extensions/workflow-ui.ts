/**
 * 现代化工作流可视化 UI
 *
 * 提供：
 * 1. 工作流阶段进度条（编辑器上方 widget）
 * 2. 并行任务面板（编辑器下方 widget）
 * 3. 现代化 Header 风格
 */

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
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
    icon: string;
}

const WORKFLOW_STEPS: StepInfo[] = [
    { key: 'clarify', label: '需求澄清', icon: '1' },
    { key: 'issue', label: '创建 Issue', icon: '2' },
    { key: 'branch', label: '创建分支', icon: '3' },
    { key: 'code', label: '编码实现', icon: '4' },
    { key: 'verify', label: '验证测试', icon: '5' },
    { key: 'commit', label: '提交代码', icon: '6' },
    { key: 'push', label: '推送分支', icon: '7' },
    { key: 'pr-create', label: '创建 PR', icon: '8' },
    { key: 'review', label: '代码审核', icon: '9' },
    { key: 'merge', label: '合并代码', icon: '0' },
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

export interface WorkflowState {
    currentStep: WorkflowStep;
    completedSteps: Set<WorkflowStep>;
    parallelTasks: ParallelTask[];
    startTime: number;
}

export interface ParallelTask {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    step: WorkflowStep;
    startTime: number;
    endTime?: number;
}

let workflowState: WorkflowState = {
    currentStep: 'idle',
    completedSteps: new Set(),
    parallelTasks: [],
    startTime: Date.now(),
};

let workflowWidgetHandle: { requestRender: () => void } | undefined;
let taskWidgetHandle: { requestRender: () => void } | undefined;

export function resetWorkflowState(): void {
    workflowState = {
        currentStep: 'idle',
        completedSteps: new Set(),
        parallelTasks: [],
        startTime: Date.now(),
    };
}

export function getWorkflowState(): WorkflowState {
    return workflowState;
}

export function advanceWorkflowStep(toolName: string): void {
    const step = TOOL_STEP_MAP[toolName];
    if (!step) return;

    if (workflowState.currentStep !== 'idle' && workflowState.currentStep !== step) {
        workflowState.completedSteps.add(workflowState.currentStep);
    }

    workflowState.currentStep = step;

    const taskId = `${step}-${Date.now()}`;
    workflowState.parallelTasks.push({
        id: taskId,
        name: getStepLabel(step),
        status: 'running',
        step,
        startTime: Date.now(),
    });

    if (workflowState.parallelTasks.length > 20) {
        workflowState.parallelTasks = workflowState.parallelTasks.slice(-20);
    }

    workflowWidgetHandle?.requestRender();
    taskWidgetHandle?.requestRender();
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

    taskWidgetHandle?.requestRender();
    workflowWidgetHandle?.requestRender();
}

function getStepLabel(step: WorkflowStep): string {
    const info = WORKFLOW_STEPS.find((s) => s.key === step);
    return info ? `${info.icon} ${info.label}` : step;
}

// ── 进度条组件 ──────────────────────────────────────────────

class WorkflowProgressBar implements Component {
    private cachedWidth?: number;
    private cachedLines?: string[];

    render(width: number): string[] {
        if (this.cachedLines && this.cachedWidth === width) {
            return this.cachedLines;
        }

        const lines = this.buildProgressBar(width);
        this.cachedLines = lines;
        this.cachedWidth = width;
        return lines;
    }

    private buildProgressBar(width: number): string[] {
        const theme = globalTheme;
        if (!theme) return [];

        const steps = WORKFLOW_STEPS;
        const currentIdx = steps.findIndex((s) => s.key === workflowState.currentStep);
        const progress = currentIdx >= 0 ? currentIdx : 0;
        const total = steps.length;

        const lines: string[] = [];
        lines.push('');

        // 第一行：进度百分比和当前阶段
        const percent = Math.round((progress / (total - 1)) * 100);
        const currentStep = steps[currentIdx];
        const currentLabel = currentStep
            ? `${currentStep.icon} ${theme.fg('accent', theme.bold(currentStep.label))}`
            : theme.fg('muted', '等待开始');

        const leftPart = `${theme.fg('muted', '工作流进度')} ${theme.fg('accent', `${percent}%`)}`;
        const gap = width - visibleWidth(leftPart) - visibleWidth(currentLabel) - 2;
        const topLine = gap > 0
            ? `${leftPart}${' '.repeat(gap)}${currentLabel}`
            : truncateToWidth(`${leftPart} ${currentLabel}`, width);
        lines.push(truncateToWidth(topLine, width));

        // 第二行：进度条（━ ━ ━ ━ ━ ─ ─ ─）
        const barTotalWidth = Math.max(20, width - 4);
        const filled = Math.round((progress / (total - 1)) * barTotalWidth);
        const empty = barTotalWidth - filled;
        const bar = theme.fg('accent', '━'.repeat(filled)) + theme.fg('dim', '─'.repeat(empty));
        lines.push(`  ${bar}`);

        // 第三行：步骤指示器（带图标和标签）
        const stepWidth = Math.max(7, Math.floor((width - 4) / total));
        const stepLineParts: string[] = [];

        for (let i = 0; i < total; i++) {
            const step = steps[i];
            const isDone = workflowState.completedSteps.has(step.key);
            const isActive = i === currentIdx;

            if (isDone) {
                stepLineParts.push(theme.fg('success', `✓${step.icon}`));
            } else if (isActive) {
                stepLineParts.push(theme.fg('accent', `▶${step.icon}`));
            } else {
                stepLineParts.push(theme.fg('dim', `○${step.icon}`));
            }
        }
        lines.push('  ' + stepLineParts.join(' '));

        // 第四行：步骤名称（只显示前两字）
        const labelParts: string[] = [];
        for (let i = 0; i < total; i++) {
            const step = steps[i];
            const isDone = workflowState.completedSteps.has(step.key);
            const isActive = i === currentIdx;
            const short = step.label.slice(0, 2);
            if (isActive) {
                labelParts.push(theme.fg('accent', theme.bold(short)));
            } else if (isDone) {
                labelParts.push(theme.fg('success', short));
            } else {
                labelParts.push(theme.fg('dim', short));
            }
        }
        lines.push('   ' + labelParts.join('  '));
        lines.push('');

        return lines.map((line) => truncateToWidth(line, width));
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

        const lines = this.buildTaskPanel(width);
        this.cachedLines = lines;
        this.cachedWidth = width;
        return lines;
    }

    private buildTaskPanel(width: number): string[] {
        const theme = globalTheme;
        if (!theme) return [];

        const tasks = workflowState.parallelTasks.slice(-10);
        if (tasks.length === 0) return [];

        const lines: string[] = [];

        // 顶部分隔线
        lines.push(theme.fg('borderMuted', '─'.repeat(width)));

        // 标题行
        const runningCount = tasks.filter((t) => t.status === 'running').length;
        const doneCount = tasks.filter((t) => t.status === 'done').length;
        const errorCount = tasks.filter((t) => t.status === 'error').length;

        const titleParts: string[] = [theme.bold('并行任务')];
        if (runningCount > 0) titleParts.push(theme.fg('accent', `${runningCount} 进行中`));
        if (doneCount > 0) titleParts.push(theme.fg('success', `${doneCount} 完成`));
        if (errorCount > 0) titleParts.push(theme.fg('error', `${errorCount} 失败`));

        lines.push(` ${titleParts.join('  |  ')}`);
        lines.push(theme.fg('borderMuted', '─'.repeat(width)));

        // 任务列表
        for (const task of tasks) {
            const icon =
                task.status === 'done'
                    ? theme.fg('success', '✓')
                    : task.status === 'error'
                      ? theme.fg('error', '✗')
                      : task.status === 'running'
                        ? theme.fg('accent', '▶')
                        : theme.fg('dim', '○');

            const name = truncateToWidth(task.name, Math.max(20, width - 35));
            const duration = task.endTime
                ? `${((task.endTime - task.startTime) / 1000).toFixed(1)}s`
                : `${((Date.now() - task.startTime) / 1000).toFixed(1)}s`;

            const statusColor =
                task.status === 'done'
                    ? 'success'
                    : task.status === 'error'
                      ? 'error'
                      : task.status === 'running'
                        ? 'accent'
                        : 'muted';

            const statusLabel =
                task.status === 'running'
                    ? '进行中'
                    : task.status === 'done'
                      ? '完成'
                      : task.status === 'error'
                        ? '失败'
                        : '等待';

            const rightPart = `${theme.fg('dim', duration)} ${theme.fg(statusColor, statusLabel)}`;
            const gap = Math.max(1, width - visibleWidth(`  ${icon} ${name}  `) - visibleWidth(rightPart));

            lines.push(`  ${icon} ${name}${' '.repeat(gap)}${rightPart}`);
        }

        lines.push('');
        return lines.map((line) => truncateToWidth(line, width));
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

    // 1. 安装工作流进度条 widget（编辑器上方）
    const progressBar = new WorkflowProgressBar();
    ctx.ui.setWidget('raccoon-workflow-progress', (_tui, theme) => {
        globalTheme = theme;
        return {
            render: (w: number) => progressBar.render(w),
            invalidate: () => progressBar.invalidate(),
        };
    });

    // 2. 安装并行任务面板 widget（编辑器下方）
    const taskPanel = new ParallelTaskPanel();
    ctx.ui.setWidget(
        'raccoon-parallel-tasks',
        (_tui, theme) => {
            globalTheme = theme;
            return {
                render: (w: number) => taskPanel.render(w),
                invalidate: () => taskPanel.invalidate(),
            };
        },
        { placement: 'belowEditor' },
    );

    // 3. 监听工具执行事件来更新状态
    pi.on('tool_execution_start', (event) => {
        advanceWorkflowStep(event.toolName);
    });

    pi.on('tool_execution_end', (event) => {
        completeTask(event.toolName, !event.isError);
    });

    // 4. 会话开始时重置状态
    pi.on('session_start', () => {
        resetWorkflowState();
        progressBar.invalidate();
        taskPanel.invalidate();
    });
}
