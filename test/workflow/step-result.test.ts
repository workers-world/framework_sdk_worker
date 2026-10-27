import { describe, expect, it } from 'vitest';
import {
    isWorkflowStepError,
    isWorkflowStepResult,
    isWorkflowStepSkipped,
    workflowStepErr,
    workflowStepMessage,
    workflowStepOk,
    workflowStepSkip,
} from '../../src/workflow/step-result.js';

describe('WorkflowStepResult helpers', () => {
    it('workflowStepOk defaults empty payload', () => {
        expect(workflowStepOk('任务已加载')).toEqual({
            status: 'ok',
            message: '任务已加载',
            payload: {},
        });
    });

    it('workflowStepSkip carries payload', () => {
        expect(workflowStepSkip('任务已暂停', { kind: 'paused' })).toEqual({
            status: 'skipped',
            message: '任务已暂停',
            payload: { kind: 'paused' },
        });
    });

    it('workflowStepErr carries error detail', () => {
        expect(workflowStepErr('失败', { error: 'boom' })).toEqual({
            status: 'error',
            message: '失败',
            payload: { error: 'boom' },
        });
    });

    it('isWorkflowStepResult rejects bare ok objects', () => {
        expect(isWorkflowStepResult({ ok: true })).toBe(false);
        expect(isWorkflowStepResult(workflowStepOk('x'))).toBe(true);
    });

    it('parsers read status/message', () => {
        expect(isWorkflowStepError(workflowStepErr('e'))).toBe(true);
        expect(isWorkflowStepSkipped(workflowStepSkip('s'))).toBe(true);
        expect(workflowStepMessage(workflowStepOk('摘要'))).toBe('摘要');
        expect(workflowStepMessage({ ok: true })).toBe(null);
    });
});
