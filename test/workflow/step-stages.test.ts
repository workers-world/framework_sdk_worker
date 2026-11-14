import { describe, expect, it } from 'vitest';
import { stepStages, type WorkflowStepStageEvent } from '../../src/workflow/step-stages.js';

const NS = 'workers-world.sch1.task.workflow';

function envelope(
    typeSuffix: string,
    stepName: string,
    output?: Record<string, unknown>,
    time?: string,
): WorkflowStepStageEvent {
    return {
        id: `${typeSuffix}-${stepName}`,
        type: `${NS}.${typeSuffix}`,
        time,
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

    it('fills detail with step/attempt event log lines and step.completed JSON', () => {
        const step = '00-登记实例-1';
        const output = {
            status: 'ok',
            message: '登记实例已存在，复用',
            payload: { id: 2, created: false },
        };
        const events: WorkflowStepStageEvent[] = [
            {
                type: `${NS}.step.started`,
                time: '2026-11-14T06:47:01.636Z',
                wwsummary: `步骤开始: ${step}`,
                data: { stepName: step, attempt: 1 },
            },
            {
                type: `${NS}.attempt.started`,
                time: '2026-11-14T06:47:01.636Z',
                wwsummary: `第 1 次尝试: ${step}`,
                data: { stepName: step, attempt: 1 },
            },
            {
                type: `${NS}.attempt.completed`,
                time: '2026-11-14T06:47:01.645Z',
                wwsummary: `尝试成功: ${step}`,
                data: { stepName: step, attempt: 1 },
            },
            {
                type: `${NS}.step.completed`,
                time: '2026-11-14T06:47:01.645Z',
                wwsummary: `步骤完成: ${step}`,
                data: { stepName: step, attempt: 1, output },
            },
        ];
        const stages = stepStages(events, null);
        expect(stages).toHaveLength(1);
        expect(stages[0]?.status).toBe('success');
        expect(stages[0]?.message).toBe(`步骤完成: ${step}`);
        expect(stages[0]?.detail).toBe(
            [
                '2026-11-14T06:47:01.636Z · step.started: 步骤开始: 00-登记实例-1',
                '2026-11-14T06:47:01.636Z · attempt.started: 第 1 次尝试: 00-登记实例-1',
                '  attempt=1',
                '2026-11-14T06:47:01.645Z · attempt.completed: 尝试成功: 00-登记实例-1',
                '  attempt=1',
                '2026-11-14T06:47:01.645Z · step.completed: 步骤完成: 00-登记实例-1',
                JSON.stringify(output, null, 2),
            ].join('\n'),
        );
    });

    it('omits detail when step has no qualifying log events', () => {
        const stages = stepStages(
            [
                {
                    type: `${NS}.workflow.running`,
                    wwsummary: 'Workflow 运行中',
                    data: { stepName: 'orphan-metrics' },
                },
            ],
            null,
        );
        expect(stages).toHaveLength(1);
        expect(stages[0]?.detail).toBeUndefined();
        expect(stages[0]?.message).toBe('Workflow 运行中');
        expect(stages[0]?.status).toBe('pending');
    });

    it('leaves message and status unchanged when detail is present', () => {
        const stages = stepStages(
            [
                envelope('step.started', '03-点名缺项', undefined, '2026-01-01T00:00:00.000Z'),
                completed('03-点名缺项', { status: 'skipped', message: 'Lock 已齐', payload: {} }),
            ],
            null,
        );
        const step = stages.find((s) => s.id === '03-点名缺项');
        expect(step?.status).toBe('skipped');
        expect(step?.message).toBe('Lock 已齐');
        expect(step?.detail).toContain('step.started');
        expect(step?.detail).toContain('step.completed');
    });
});
