import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CursorStreamExpiredError,
    CursorStreamUnavailableError,
    fetchCursorAgentRun,
    fetchCursorAgentUsage,
    mapCursorSseFrame,
    pollCursorAgentRun,
    streamCursorAgentRun,
} from '../../src/cursor/cloud-agent.js';

const API_KEY = 'cursor-key';
const REF = { agentId: 'a1', runId: 'r1' };

describe('mapCursorSseFrame remaining events', () => {
    it('maps status assistant thinking tool_call error done and ignores others', () => {
        expect(mapCursorSseFrame({ event: 'status', data: '{}' })).toMatchObject({
            type: 'status',
            status: 'UNKNOWN',
        });
        expect(mapCursorSseFrame({ id: '1', event: 'assistant', data: 'not-json' })).toMatchObject({
            id: '1',
            type: 'assistant',
            text: '',
        });
        expect(mapCursorSseFrame({ event: 'thinking', data: '{"text":"hmm"}' })).toMatchObject({
            type: 'thinking',
            text: 'hmm',
        });
        expect(
            mapCursorSseFrame({
                event: 'tool_call',
                data: '{"callId":"c","name":"n","status":"running"}',
            }),
        ).toMatchObject({ type: 'tool_call', status: 'running' });
        expect(mapCursorSseFrame({ event: 'error', data: '{}' })).toMatchObject({
            type: 'error',
            code: 'stream_error',
        });
        expect(mapCursorSseFrame({ event: 'done', data: '' })).toEqual({ type: 'done' });
        expect(mapCursorSseFrame({ event: 'interaction_update', data: '{}' })).toBeNull();
        expect(mapCursorSseFrame({ event: 'unknown', data: '{}' })).toBeNull();
        expect(mapCursorSseFrame({ event: 'result', data: '{"git":null}' })).toMatchObject({
            type: 'result',
            status: 'UNKNOWN',
        });
    });
});

describe('fetchCursorAgentRun / poll / usage remaining', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns config errors without api key', async () => {
        await expect(fetchCursorAgentRun('', REF)).resolves.toMatchObject({
            status: 'ERROR',
            terminal: true,
            error: 'CURSOR_API_KEY not configured',
        });
        await expect(pollCursorAgentRun('', REF)).resolves.toEqual({
            status: 'ERROR',
            error: 'CURSOR_API_KEY not configured',
        });
        await expect(fetchCursorAgentUsage('', 'a1')).resolves.toEqual({
            ok: false,
            error: 'CURSOR_API_KEY not configured',
        });
        const events = [];
        for await (const ev of streamCursorAgentRun('', REF)) {
            events.push(ev);
        }
        expect(events[0]).toMatchObject({ type: 'error', code: 'config' });
    });

    it('maps fetch success and HTTP error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            status: 'ERROR',
                            error: { message: 'boom' },
                        }),
                        { status: 200 },
                    ),
            ),
        );
        await expect(fetchCursorAgentRun(API_KEY, REF)).resolves.toMatchObject({
            status: 'ERROR',
            terminal: true,
        });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 })),
        );
        await expect(fetchCursorAgentRun(API_KEY, REF)).resolves.toMatchObject({
            status: 'ERROR',
            terminal: true,
        });
        await expect(fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' })).resolves.toMatchObject({
            ok: false,
        });
    });

    it('treats 429/5xx/network errors as retryable UNKNOWN instead of terminal ERROR', async () => {
        // 回归：任何 !resp.ok 一律 ERROR terminal，429/5xx 会误终止轮询
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'slow' }), { status: 429 })),
        );
        await expect(fetchCursorAgentRun(API_KEY, REF)).resolves.toMatchObject({
            status: 'UNKNOWN',
            terminal: false,
            retryable: true,
        });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'down' }), { status: 503 })),
        );
        await expect(fetchCursorAgentRun(API_KEY, REF)).resolves.toMatchObject({
            status: 'UNKNOWN',
            terminal: false,
            retryable: true,
        });

        // 网络瞬断：cursorFetch 归一为 status 0，不再向调用方裸抛
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }),
        );
        await expect(fetchCursorAgentRun(API_KEY, REF)).resolves.toMatchObject({
            status: 'UNKNOWN',
            terminal: false,
            retryable: true,
            error: expect.stringContaining('network down'),
        });
        await expect(fetchCursorAgentUsage(API_KEY, 'a1')).resolves.toMatchObject({
            ok: false,
            error: expect.stringContaining('network down'),
        });
    });

    it('poll keeps retrying through transient errors instead of aborting', async () => {
        // 网络瞬断（非终态）应继续按 attempt 轮询，最后一次成功
        let calls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                calls += 1;
                if (calls < 3) {
                    throw new Error('flaky');
                }
                return new Response(JSON.stringify({ status: 'FINISHED' }), { status: 200 });
            }),
        );
        await expect(
            pollCursorAgentRun(API_KEY, REF, { maxAttempts: 5, intervalMs: 1 }),
        ).resolves.toMatchObject({ status: 'FINISHED' });
        expect(calls).toBe(3);
    });
});

describe('streamCursorAgentRun remaining', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws on 410 and maps HTTP / missing body', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 410 })),
        );
        await expect(async () => {
            for await (const _ev of streamCursorAgentRun(API_KEY, REF, { lastEventId: '9' })) {
                void _ev;
            }
        }).rejects.toBeInstanceOf(CursorStreamExpiredError);

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            error: {
                                code: 'stream_unavailable',
                                message: 'Run stream is no longer available',
                            },
                        }),
                        { status: 409 },
                    ),
            ),
        );
        await expect(async () => {
            for await (const _ev of streamCursorAgentRun(API_KEY, REF)) {
                void _ev;
            }
        }).rejects.toBeInstanceOf(CursorStreamUnavailableError);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('plain-error', { status: 500 })),
        );
        const httpEvents = [];
        for await (const ev of streamCursorAgentRun(API_KEY, REF)) {
            httpEvents.push(ev);
        }
        expect(httpEvents[0]).toMatchObject({ type: 'error', code: 'http_500' });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 200 })),
        );
        const noBody = [];
        for await (const ev of streamCursorAgentRun(API_KEY, REF)) {
            noBody.push(ev);
        }
        expect(noBody[0]).toMatchObject({ type: 'error', code: 'no_body' });
    });

    it('passes caller signal / default timeout to fetch', async () => {
        // 默认整体超时：缺省 signal 为 AbortSignal.timeout(300s)
        const initCalls: RequestInit[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init?: RequestInit) => {
                initCalls.push(init ?? {});
                return new Response('event: done\ndata: {}\n\n', { status: 200 });
            }),
        );
        for await (const _ev of streamCursorAgentRun(API_KEY, REF)) {
            void _ev;
        }
        const defaultSignal = initCalls[0]?.signal as AbortSignal | undefined;
        expect(defaultSignal).toBeDefined();
        expect(defaultSignal?.aborted).toBe(false);

        // 调用方 signal 透传
        const controller = new AbortController();
        controller.abort();
        for await (const _ev of streamCursorAgentRun(API_KEY, REF, {
            signal: controller.signal,
        })) {
            void _ev;
        }
        const callerSignal = initCalls[1]?.signal as AbortSignal | undefined;
        expect(callerSignal?.aborted).toBe(true);

        // timeoutMs 覆盖默认
        for await (const _ev of streamCursorAgentRun(API_KEY, REF, { timeoutMs: 1_000 })) {
            void _ev;
        }
        expect(initCalls[2]?.signal).toBeDefined();
    });
});

describe('isCursorStreamUnavailable', () => {
    it('matches http_409 and stream_unavailable message', async () => {
        const { isCursorStreamUnavailable } = await import('../../src/cursor/cloud-agent.js');
        expect(isCursorStreamUnavailable('http_409')).toBe(true);
        expect(isCursorStreamUnavailable('stream_unavailable')).toBe(true);
        expect(isCursorStreamUnavailable('http_409', 'Run stream is no longer available')).toBe(
            true,
        );
        expect(isCursorStreamUnavailable('http_500', 'server error')).toBe(false);
    });
});
