import { describe, expect, it } from 'vitest';
import { stepStages, type WorkflowStepStageEvent } from '../../src/workflow/step-stages.js';

const NS = 'workers-world.sch1.task.workflow';

function envelope(
    typeSuffix: string,
    stepName: string,
    output?: Record<string, unknown>,
): WorkflowStepStageEvent {
    return {
        id: `${typeSuffix}-${stepName}`,
        type: `${NS}.${typeSuffix}`,
        wwsummary: stepName,
        data: { stepName, output },
    };
}

function completed(stepName: string, output: Record<string, unknown>): WorkflowStepStageEvent {
    return envelope('step.completed', stepName, output);
}

describe('stepStages', () => {
    it('maps completed / skipped / running with currentStepName', () => {
        const stages = stepStages(
            [
                completed('01-加载', { status: 'ok', message: '已加载', payload: {} }),
                completed('03-点名缺项', { status: 'skipped', message: 'Lock 已齐', payload: {} }),
                envelope('wait.started', '04-等待补描述'),
            ],
            '04-等待补描述',
        );
        expect(stages.find((s) => s.id === '01-加载')?.status).toBe('success');
        expect(stages.find((s) => s.id === '03-点名缺项')?.status).toBe('skipped');
        expect(stages.find((s) => s.id === '04-等待补描述')?.status).toBe('running');
    });

    it('marks step completed with SchStepResult error as failure', () => {
        const stages = stepStages(
            [
                completed('08b-PR转正', {
                    status: 'error',
                    message: 'PR 转正失败（不阻断完成）',
                    payload: { ok: false },
                }),
            ],
            null,
        );
        expect(stages).toHaveLength(1);
        expect(stages[0]?.status).toBe('failure');
        expect(stages[0]?.message).toBe('PR 转正失败（不阻断完成）');
    });

    it('marks normal SchStepResult ok as success', () => {
        const stages = stepStages(
            [completed('08-保存PR回执', { status: 'ok', message: 'PR 回执已保存', payload: {} })],
            null,
        );
        expect(stages[0]?.status).toBe('success');
    });

    it('marks SchStepResult skipped as skipped (not green success)', () => {
        const stages = stepStages(
            [
                completed('09-Preview探测', {
                    status: 'skipped',
                    message: '无 Preview URL',
                    payload: {},
                }),
            ],
            null,
        );
        expect(stages[0]?.status).toBe('skipped');
        expect(stages[0]?.message).toBe('无 Preview URL');
    });

    it('marks wait.completed as success for waitForEvent steps', () => {
        const stages = stepStages(
            [
                envelope('wait.started', '等待 GitHub PR 关闭'),
                envelope('wait.completed', '等待 GitHub PR 关闭'),
                completed('12-PR结论', { status: 'ok', message: 'PR 已合并并归档', payload: {} }),
            ],
            null,
        );
        const wait = stages.find((s) => s.id === '等待 GitHub PR 关闭');
        expect(wait?.status).toBe('success');
        expect(stages.find((s) => s.id === '12-PR结论')?.status).toBe('success');
    });

    it('cascades done onto wait when only wait.started then downstream completes', () => {
        const stages = stepStages(
            [
                envelope('wait.started', '等待 GitHub PR 关闭'),
                completed('12-PR结论', { status: 'ok', message: 'PR 已合并并归档', payload: {} }),
            ],
            null,
        );
        expect(stages.find((s) => s.id === '等待 GitHub PR 关闭')?.status).toBe('success');
        expect(stages.find((s) => s.id === '12-PR结论')?.status).toBe('success');
    });

    it('marks wait.timed.out as failure', () => {
        const stages = stepStages([envelope('wait.timed.out', '等待 GitHub PR 关闭')], null);
        expect(stages[0]?.status).toBe('failure');
    });

    it('maps business error output to failure (not green)', () => {
        const stages = stepStages(
            [
                completed('08-Clef决策', {
                    status: 'error',
                    message: 'Clef 失败：5006',
                    payload: { clefOk: false },
                }),
            ],
            null,
        );
        expect(stages.find((s) => s.id === '08-Clef决策')?.status).toBe('failure');
    });

    it('keeps earlier pending step pending when no signal', () => {
        const stages = stepStages(
            [
                completed('01-加载', { status: 'ok', message: '已加载', payload: {} }),
                completed('02-Lock校验', { status: 'ok', message: 'Lock 齐全', payload: {} }),
            ],
            null,
        );
        expect(stages.map((s) => s.status)).toEqual(['success', 'success']);
    });
});
