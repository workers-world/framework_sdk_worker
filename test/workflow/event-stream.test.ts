import { describe, expect, it } from 'vitest';
import {
    createWorkflowSseStream,
    noWorkflowInstanceResponse,
    type WorkflowEventSource,
    workflowEventSseResponse,
} from '../../src/workflow/event-stream.js';

function fakeWorkflow(events: unknown[]): WorkflowEventSource {
    let i = 0;
    const subscription = {
        next: async () => {
            if (i >= events.length) {
                return { done: true as const };
            }
            const value = events[i++];
            return { value, done: false as const };
        },
        [Symbol.dispose]: () => {},
    };
    return {
        get: async () => ({
            subscribe: async () => subscription,
        }),
    };
}

describe('createWorkflowSseStream', () => {
    it('emits ready then mapped events then end on terminal, with custom ns and string taskId', async () => {
        const wf = fakeWorkflow([
            {
                instanceId: 'pi-1',
                eventId: 1,
                timestamp: Date.now(),
                type: 'step_started',
                stepName: '01-加载',
            },
            {
                instanceId: 'pi-1',
                eventId: 2,
                timestamp: Date.now(),
                type: 'workflow_completed',
            },
        ]);
        const stream = createWorkflowSseStream(wf, {
            taskId: 'PGREQ1',
            instanceId: 'pi-1',
            ns: 'deploy-tracker-worker.planning.issue',
            source: '/workers/deploy-tracker-worker',
            signal: new AbortController().signal,
        });
        const text = await new Response(stream).text();
        expect(text).toContain('event: stream');
        expect(text).toContain('workers-world.io.stream.ready');
        expect(text).toContain('01-加载');
        expect(text).toContain(
            'workers-world.deploy-tracker-worker.planning.issue.workflow.step.started',
        );
        expect(text).toContain('workflow.completed');
        expect(text).toContain('workers-world.io.stream.end');
    });

    it('defaults ns and source stay sch1', async () => {
        const wf = fakeWorkflow([
            {
                instanceId: 's-1',
                eventId: 1,
                timestamp: Date.now(),
                type: 'step_completed',
                stepName: '01-加载任务',
            },
        ]);
        const stream = createWorkflowSseStream(wf, {
            taskId: 7,
            instanceId: 's-1',
            signal: new AbortController().signal,
        });
        const text = await new Response(stream).text();
        expect(text).toContain('workers-world.sch1.task.workflow.step.completed');
    });

    it('abort triggers dispose and closes stream', async () => {
        let disposed = false;
        let i = 0;
        const subscription = {
            next: async () => {
                await new Promise((r) => setTimeout(r, 50));
                return {
                    value: {
                        instanceId: 'p',
                        eventId: ++i,
                        timestamp: 1,
                        type: 'step_started',
                        stepName: 's',
                    },
                    done: false as const,
                };
            },
            [Symbol.dispose]: () => {
                disposed = true;
            },
        };
        const wf: WorkflowEventSource = {
            get: async () => ({
                subscribe: async () => subscription,
            }),
        };
        const ac = new AbortController();
        const stream = createWorkflowSseStream(wf, {
            taskId: 1,
            instanceId: 'p',
            signal: ac.signal,
        });
        const reader = stream.getReader();
        await reader.read(); // ready 帧
        ac.abort();
        const next = await reader.read();
        expect(next.done).toBe(true);
        expect(disposed).toBe(true);
    });

    it('subscribe error emits error frame', async () => {
        const wf: WorkflowEventSource = {
            get: async () => {
                throw new Error('boom');
            },
        };
        const stream = createWorkflowSseStream(wf, {
            taskId: 1,
            instanceId: 'p',
            signal: new AbortController().signal,
        });
        const text = await new Response(stream).text();
        expect(text).toContain('workers-world.io.stream.error');
        expect(text).toContain('boom');
    });
});

describe('noWorkflowInstanceResponse / workflowEventSseResponse', () => {
    it('404 envelope with custom source and instanceId', async () => {
        const res = noWorkflowInstanceResponse('PGREQ1', {
            source: '/workers/deploy-tracker-worker',
            instanceId: 'pi-9',
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as { wwerror?: { code?: string }; source?: string };
        expect(body.wwerror?.code).toBe('NO_WORKFLOW_INSTANCE');
        expect(body.source).toBe('/workers/deploy-tracker-worker');
    });

    it('sse response headers', () => {
        const res = workflowEventSseResponse(new ReadableStream());
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
        expect(res.headers.get('Cache-Control')).toContain('no-cache');
    });
});
