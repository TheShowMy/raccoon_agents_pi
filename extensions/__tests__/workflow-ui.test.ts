import { describe, it, expect } from 'vitest';
import { getWorkflowState, advanceWorkflowStep, completeTask, resetWorkflowState } from '../workflow-ui.js';

describe('workflow state', () => {
    it('初始状态不包含 review', () => {
        resetWorkflowState();
        const state = getWorkflowState();
        expect(state.completedSteps.has('review')).toBe(false);
        expect(state.currentStep).toBe('idle');
    });

    it('advanceWorkflowStep 推进步骤', () => {
        resetWorkflowState();
        advanceWorkflowStep('raccoon_pr_review');
        const state = getWorkflowState();
        expect(state.currentStep).toBe('review');
    });

    it('completeTask 标记步骤完成', () => {
        resetWorkflowState();
        advanceWorkflowStep('raccoon_pr_review');
        completeTask('raccoon_pr_review', true);
        const state = getWorkflowState();
        expect(state.completedSteps.has('review')).toBe(true);
    });

    it('失败的任务不加入 completedSteps', () => {
        resetWorkflowState();
        advanceWorkflowStep('raccoon_pr_review');
        completeTask('raccoon_pr_review', false);
        const state = getWorkflowState();
        expect(state.completedSteps.has('review')).toBe(false);
    });

    it('getWorkflowState 返回同一引用', () => {
        resetWorkflowState();
        const state1 = getWorkflowState();
        const state2 = getWorkflowState();
        expect(state1).toBe(state2);
    });
});
