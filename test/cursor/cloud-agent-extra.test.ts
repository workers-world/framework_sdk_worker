import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CursorStreamExpiredError,
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
});
