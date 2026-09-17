import { describe, expect, it } from 'vitest';
import {
    createWorkerIoEnvelope,
    isWorkerIoEnvelope,
    isWorkerIoTerminal,
    STREAM_WORKFLOW_INSTANCE,
} from '../../src/io/envelope.js';
import {
    assertWorkerIoEnvelope,
    decodeWorkerIoEnvelope,
    encodeWorkerIoEnvelope,
    tryDecodeWorkerIoEnvelope,
    WorkerIoDecodeError,
} from '../../src/io/serde.js';
import { decodeWorkerIoQueueBody } from '../../src/io/transports/queue.js';
import { decodeWorkerIoSseFrame, encodeWorkerIoSseFrame } from '../../src/io/transports/sse.js';
import {
    createWorkflowStreamControl,
    mapWorkflowInstanceEvent,
} from '../../src/workflow/instance-events.js';

describe('WorkerIoEnvelope', () => {
    it('create + encode/decode roundtrip', () => {
        const e = createWorkerIoEnvelope({
            id: 'a:1',
            source: '/workers/sch1',
            type: 'workers-world.sch1.task.workflow.step.completed',
            data: { taskId: 1 },
            wwstream: STREAM_WORKFLOW_INSTANCE,
            wwsummary: 'ok',
        });
        expect(isWorkerIoEnvelope(e)).toBe(true);
        const json = encodeWorkerIoEnvelope(e);
        const back = decodeWorkerIoEnvelope(json);
        expect(back.id).toBe('a:1');
        expect(back.data).toEqual({ taskId: 1 });
    });

    it('assert rejects non-envelope', () => {
        expect(() => assertWorkerIoEnvelope({ foo: 1 })).toThrow(WorkerIoDecodeError);
    });

    it('isWorkerIoTerminal respects wwterminal and type', () => {
        const t = createWorkerIoEnvelope({
            id: '1',
            source: '/workers/sch1',
            type: 'workers-world.sch1.task.workflow.workflow.completed',
            wwterminal: true,
        });
        expect(isWorkerIoTerminal(t)).toBe(true);
        const end = createWorkerIoEnvelope({
            id: '0',
            source: '/workers/sch1',
            type: 'workers-world.io.stream.end',
        });
        expect(isWorkerIoTerminal(end)).toBe(true);
    });

    it('isWorkerIoEnvelope rejects non-objects and isWorkerIoTerminal checks type suffixes', () => {
        expect(isWorkerIoEnvelope(null)).toBe(false);
        expect(isWorkerIoEnvelope('x')).toBe(false);
        expect(isWorkerIoEnvelope({ specversion: '1.0' })).toBe(false);
        const completed = createWorkerIoEnvelope({
            id: '1',
            source: '/w',
            type: 'workers-world.workflow.completed',
        });
        expect(isWorkerIoTerminal(completed)).toBe(true);
        const errored = createWorkerIoEnvelope({
            id: '1',
            source: '/w',
            type: 'foo.workflow.errored',
        });
        expect(isWorkerIoTerminal(errored)).toBe(true);
        const terminated = createWorkerIoEnvelope({
            id: '1',
            source: '/w',
            type: 'workers-world.workflow.terminated',
        });
        expect(isWorkerIoTerminal(terminated)).toBe(true);
        const withError = createWorkerIoEnvelope({
            id: '1',
            source: '/w',
            type: 'x',
            wwerror: { code: 'E', message: 'm' },
        });
        expect(withError.wwerror?.code).toBe('E');
        expect(tryDecodeWorkerIoEnvelope('{not json')).toBeNull();
    });
});

describe('SSE transport', () => {
    it('encode/decode frame', () => {
        const e = createWorkerIoEnvelope({
            id: 'inst:8',
            source: '/workers/sch1',
            type: 'workers-world.sch1.task.workflow.step.started',
            wwstream: STREAM_WORKFLOW_INSTANCE,
        });
        const frameText = encodeWorkerIoSseFrame(e);
        expect(frameText).toContain('event: stream');
        expect(frameText).toContain('id: inst:8');
        const parsed = decodeWorkerIoSseFrame({
            event: 'stream',
            id: 'inst:8',
            data: encodeWorkerIoEnvelope(e),
        });
        expect(parsed?.id).toBe('inst:8');
    });
});

describe('Queue transport', () => {
    it('decodes string body', () => {
        const e = createWorkerIoEnvelope({
            id: 'q1',
            source: '/workers/sch1',
            type: 'workers-world.sch1.job',
        });
        const body = encodeWorkerIoEnvelope(e);
        expect(decodeWorkerIoQueueBody(body).id).toBe('q1');
        expect(decodeWorkerIoQueueBody(JSON.parse(body)).id).toBe('q1');
    });
});

describe('mapWorkflowInstanceEvent', () => {
    it('maps step_completed', () => {
        const env = mapWorkflowInstanceEvent(
            {
                instanceId: 'SCH1-a1',
                eventId: 8,
                timestamp: Date.parse('2026-09-16T10:00:12.000Z'),
                type: 'step_completed',
                stepName: '07-消费SSE轨迹',
                output: { status: 'ok' },
            },
            { taskId: 42 },
        );
        expect(env.id).toBe('SCH1-a1:8');
        expect(env.wwstream).toBe(STREAM_WORKFLOW_INSTANCE);
        expect(env.wwcategory).toBe('step');
        expect(env.data?.stepName).toBe('07-消费SSE轨迹');
        expect(env.wwterminal).toBeUndefined();
    });

    it('marks workflow_completed terminal', () => {
        const env = mapWorkflowInstanceEvent(
            {
                instanceId: 'SCH1-a1',
                eventId: 24,
                timestamp: Date.now(),
                type: 'workflow_completed',
            },
            { taskId: 42 },
        );
        expect(env.wwterminal).toBe(true);
        expect(isWorkerIoTerminal(env)).toBe(true);
    });

    it('stream control frames', () => {
        const ready = createWorkflowStreamControl('ready', {
            taskId: 1,
            instanceId: 'x',
        });
        expect(ready.type).toBe('workers-world.io.stream.ready');
        expect(ready.id.startsWith('0:')).toBe(true);
    });
});
