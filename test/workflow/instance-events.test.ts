import { describe, expect, it } from 'vitest';
import {
    cfTypeToWorkerIoType,
    createWorkflowStreamControl,
    isCfWorkflowTerminalType,
    mapWorkflowInstanceEvent,
} from '../../src/workflow/instance-events.js';

const BASE = {
    instanceId: 'SCH1-a1',
    eventId: 1,
    timestamp: Date.parse('2026-09-16T10:00:12.000Z'),
};

describe('cfTypeToWorkerIoType / terminal', () => {
    it('dots underscores and detects terminal types', () => {
        expect(cfTypeToWorkerIoType('step_completed')).toBe(
            'workers-world.sch1.task.workflow.step.completed',
        );
        expect(isCfWorkflowTerminalType('workflow_completed')).toBe(true);
        expect(isCfWorkflowTerminalType('workflow_errored')).toBe(true);
        expect(isCfWorkflowTerminalType('workflow_terminated')).toBe(true);
        expect(isCfWorkflowTerminalType('step_completed')).toBe(false);
    });
});

describe('mapWorkflowInstanceEvent categories and summaries', () => {
    const cases: Array<{ type: string; category: string; summary: string; extra?: object }> = [
        { type: 'workflow_queued', category: 'workflow', summary: '已进入执行队列' },
        { type: 'workflow_started', category: 'workflow', summary: 'Workflow 已开始' },
        { type: 'workflow_running', category: 'workflow', summary: 'Workflow 运行中' },
        { type: 'workflow_paused', category: 'workflow', summary: 'Workflow 已暂停' },
        { type: 'workflow_waiting', category: 'workflow', summary: 'Workflow 等待中' },
        { type: 'workflow_waiting_for_pause', category: 'workflow', summary: 'Workflow 等待暂停' },
        { type: 'workflow_completed', category: 'lifecycle', summary: 'Workflow 已完成' },
        {
            type: 'workflow_errored',
            category: 'lifecycle',
            summary: 'Workflow 出错：boom',
            extra: { error: { name: 'Err', message: 'boom' } },
        },
        { type: 'workflow_terminated', category: 'lifecycle', summary: 'Workflow 已终止' },
        {
            type: 'step_started',
            category: 'step',
            summary: '步骤开始：s1',
            extra: { stepName: 's1' },
        },
        { type: 'step_completed', category: 'step', summary: '步骤完成' },
        { type: 'step_errored', category: 'step', summary: '步骤失败' },
        {
            type: 'attempt_started',
            category: 'attempt',
            summary: '第 2 次尝试',
            extra: { attempt: 2 },
        },
        { type: 'attempt_completed', category: 'attempt', summary: '尝试成功' },
        { type: 'attempt_errored', category: 'attempt', summary: '尝试失败' },
        { type: 'sleep_started', category: 'sleep', summary: '睡眠开始' },
        { type: 'sleep_completed', category: 'sleep', summary: '睡眠结束' },
        { type: 'wait_started', category: 'wait', summary: '等待事件' },
        { type: 'wait_completed', category: 'wait', summary: '等待完成' },
        { type: 'wait_timed_out', category: 'wait', summary: '等待超时' },
        { type: 'rollback_started', category: 'rollback', summary: '回滚：rollback_started' },
        { type: 'custom_event', category: 'system', summary: 'custom_event' },
    ];

    it.each(cases)('$type', ({ type, category, summary, extra }) => {
        const env = mapWorkflowInstanceEvent(
            { ...BASE, type, ...(extra as object) },
            { taskId: 7, source: '/workers/x' },
        );
        expect(env.wwcategory).toBe(category);
        expect(env.wwsummary).toBe(summary);
        expect(env.source).toBe('/workers/x');
        expect(env.data?.taskId).toBe(7);
    });

    it('copies optional data fields and default source', () => {
        const env = mapWorkflowInstanceEvent(
            {
                ...BASE,
                type: 'wait_started',
                stepName: 'w',
                attempt: 1,
                durationMs: 10,
                retryDelayMs: 5,
                eventType: 'resume',
                output: { ok: true },
                error: { name: '', message: 'x' },
            },
            { taskId: 1 },
        );
        expect(env.source).toBe('/workers/sch1');
        expect(env.data).toMatchObject({
            stepName: 'w',
            attempt: 1,
            durationMs: 10,
            retryDelayMs: 5,
            waitEventType: 'resume',
            output: { ok: true },
        });
        expect(env.wwerror).toEqual({ code: 'Error', message: 'x' });
    });

    it('defaults workflow_errored message', () => {
        const env = mapWorkflowInstanceEvent({ ...BASE, type: 'workflow_errored' }, { taskId: 1 });
        expect(env.wwsummary).toBe('Workflow 出错：unknown');
    });

    it('rollback with stepName', () => {
        const env = mapWorkflowInstanceEvent(
            { ...BASE, type: 'rollback', stepName: 's' },
            { taskId: 1 },
        );
        expect(env.wwsummary).toBe('回滚：s');
        expect(env.wwcategory).toBe('rollback');
    });
});

describe('createWorkflowStreamControl', () => {
    it('maps ready/error/end', () => {
        const ready = createWorkflowStreamControl('ready', { taskId: 1, instanceId: 'i' });
        expect(ready.type).toBe('workers-world.io.stream.ready');
        expect(ready.wwsummary).toBe('订阅已建立');
        expect(ready.wwterminal).toBeUndefined();

        const err = createWorkflowStreamControl('error', {
            taskId: 1,
            instanceId: 'i',
            error: { name: 'E', message: 'nope' },
        });
        expect(err.type).toBe('workers-world.io.stream.error');
        expect(err.wwsummary).toBe('无法订阅：nope');
        expect(err.wwerror).toEqual({ code: 'E', message: 'nope' });

        const end = createWorkflowStreamControl('end', { taskId: 1, instanceId: 'i' });
        expect(end.type).toBe('workers-world.io.stream.end');
        expect(end.wwterminal).toBe(true);
        expect(end.wwsummary).toBe('流已结束');
    });

    it('defaults error message and code', () => {
        const err = createWorkflowStreamControl('error', { taskId: 1, instanceId: 'i' });
        expect(err.wwsummary).toBe('无法订阅：unknown');
        const named = createWorkflowStreamControl('error', {
            taskId: 1,
            instanceId: 'i',
            error: { name: '', message: 'm' },
        });
        expect(named.wwerror?.code).toBe('Error');
    });
});
