import { describe, expect, it, vi } from 'vitest';
import {
    isWorkflowStepError,
    isWorkflowStepResult,
    isWorkflowStepSkipped,
    unwrapWorkflowStep,
    withWorkflowStepCatch,
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

    it('withWorkflowStepCatch passes through ok', async () => {
        const out = await withWorkflowStepCatch(async () => workflowStepOk('ok', { n: 1 }));
        expect(out).toEqual({ status: 'ok', message: 'ok', payload: { n: 1 } });
    });

    it('withWorkflowStepCatch maps throw to workflowStepErr', async () => {
        const onCatch = vi.fn();
        const out = await withWorkflowStepCatch(
            async () => {
                throw new Error('boom');
            },
            { extraPayload: { code: 'X' }, onCatch },
        );
        expect(out).toEqual({
            status: 'error',
            message: 'boom',
            payload: { code: 'X' },
        });
        expect(onCatch).toHaveBeenCalledWith('boom', expect.any(Error));
    });

    it('unwrapWorkflowStep returns payload for ok and skipped', async () => {
        await expect(
            unwrapWorkflowStep(workflowStepOk('a', { v: 1 }), async () => {
                throw new Error('should not');
            }),
        ).resolves.toEqual({ v: 1 });
        await expect(
            unwrapWorkflowStep(workflowStepSkip('s', { v: 2 }), async () => {
                throw new Error('should not');
            }),
        ).resolves.toEqual({ v: 2 });
    });

    it('unwrapWorkflowStep calls onError for error status', async () => {
        const onError = vi.fn(async () => {
            throw new Error('fatal');
        });
        await expect(
            unwrapWorkflowStep(workflowStepErr('坏了', { code: 'c' }), onError),
        ).rejects.toThrow('fatal');
        expect(onError).toHaveBeenCalledWith(
            '坏了',
            expect.objectContaining({ status: 'error', message: '坏了' }),
        );
    });
});
