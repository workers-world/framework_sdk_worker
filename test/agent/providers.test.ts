import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAgentModelRef, normalizeAgentModelInput } from '../../src/agent/model-ref.js';
import type { AgentProviderContext } from '../../src/agent/provider.js';
import { cursorAgentProvider } from '../../src/agent/providers/cursor.js';
import {
    copilotAgentProvider,
    selfHostedAgentProvider,
    smokeAgentProvider,
} from '../../src/agent/providers/stub.js';
import {
    createAgentRun,
    fetchAgentRun,
    listAgentModels,
    streamAgentRun,
} from '../../src/agent/registry.js';
import { mapCursorStreamEvent } from '../../src/agent/stream.js';

const ctx: AgentProviderContext = { secrets: { CURSOR_API_KEY: 'k' } };
const emptyCtx: AgentProviderContext = { secrets: {} };

describe('stub providers', () => {
    it('listModels and createRun fail closed', async () => {
        await expect(selfHostedAgentProvider.listModels(emptyCtx)).resolves.toMatchObject({
            ok: false,
            provider: 'selfhosted',
        });
        await expect(
            smokeAgentProvider.createRun(
                { repoUrl: 'https://github.com/o/r', promptText: 'x' },
                emptyCtx,
            ),
        ).resolves.toMatchObject({ ok: false });
        expect(copilotAgentProvider.capabilities.remoteRun).toBe(true);
        expect(copilotAgentProvider.capabilities.autoPr).toBe(true);
    });
});

describe('cursorAgentProvider without key', () => {
    it('returns config errors', async () => {
        await expect(cursorAgentProvider.listModels(emptyCtx)).resolves.toEqual({
            ok: false,
            provider: 'cursor',
            error: 'CURSOR_API_KEY not configured',
        });
        await expect(
            cursorAgentProvider.createRun(
                { repoUrl: 'https://github.com/o/r', promptText: 'x' },
                emptyCtx,
            ),
        ).resolves.toEqual({ ok: false, error: 'CURSOR_API_KEY not configured' });
        const fetchRun = cursorAgentProvider.fetchRun;
        const streamRun = cursorAgentProvider.streamRun;
        expect(fetchRun).toBeTypeOf('function');
        expect(streamRun).toBeTypeOf('function');
        if (!fetchRun || !streamRun) {
            return;
        }

        await expect(
            fetchRun({ agentId: 'a', provider: 'cursor', runId: 'r' }, emptyCtx),
        ).resolves.toEqual({ status: 'ERROR', error: 'CURSOR_API_KEY not configured' });

        const events = [];
        for await (const ev of streamRun(
            { agentId: 'a', provider: 'cursor', runId: 'r' },
            emptyCtx,
        )) {
            events.push(ev);
        }
        expect(events[0]).toMatchObject({ eventType: 'error', payload: { code: 'config' } });
    });

    it('mapStreamEvent guards', () => {
        expect(cursorAgentProvider.mapStreamEvent?.(null)).toBeNull();
        expect(cursorAgentProvider.mapStreamEvent?.(1)).toBeNull();
        expect(cursorAgentProvider.mapStreamEvent?.({ foo: 1 })).toBeNull();
        expect(cursorAgentProvider.mapStreamEvent?.({ type: 'done' })).toMatchObject({
            eventType: 'meta',
        });
    });
});

describe('cursorAgentProvider with fetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('createRun maps success and failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            agent: { id: 'ag1' },
                            run: { id: 'run1', status: 'CREATING' },
                        }),
                        { status: 200 },
                    ),
            ),
        );
        const ok = await cursorAgentProvider.createRun(
            {
                repoUrl: 'https://github.com/o/r',
                promptText: 'do it',
                model: 'composer-2.5',
                autoCreatePR: true,
                name: 'n',
            },
            ctx,
        );
        expect(ok.ok).toBe(true);
        if (ok.ok) {
            expect(ok.ref).toMatchObject({ provider: 'cursor', agentId: 'ag1' });
        }

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 }),
            ),
        );
        const bad = await cursorAgentProvider.createRun(
            { repoUrl: 'https://github.com/o/r', promptText: 'x' },
            ctx,
        );
        expect(bad.ok).toBe(false);
    });

    it('throws when stream/fetch ref lacks runId', async () => {
        const fetchRun = cursorAgentProvider.fetchRun;
        const streamRun = cursorAgentProvider.streamRun;
        expect(fetchRun).toBeTypeOf('function');
        expect(streamRun).toBeTypeOf('function');
        if (!fetchRun || !streamRun) {
            return;
        }

        await expect(fetchRun({ agentId: 'a', provider: 'cursor' }, ctx)).rejects.toThrow(
            'cursor run requires runId',
        );
        const iter = streamRun({ agentId: 'a', provider: 'cursor' }, ctx);
        await expect(iter.next()).rejects.toThrow('cursor run requires runId');
    });
});

describe('registry capability gates', () => {
    it('listAgentModels rejects providers without listModels', async () => {
        const result = await listAgentModels('selfhosted', emptyCtx);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not support listModels');
    });

    it('createAgentRun defaults provider to cursor and rejects smoke', async () => {
        const smoke = await createAgentRun(
            { provider: 'smoke', repoUrl: 'https://github.com/o/r', promptText: 'x' },
            emptyCtx,
        );
        expect(smoke.ok).toBe(false);
        expect(smoke.error).toContain('does not support remote agent runs');
    });

    it('fetchAgentRun / streamAgentRun unsupported on stub', async () => {
        await expect(
            fetchAgentRun({ provider: 'selfhosted', agentId: 'a' }, emptyCtx),
        ).resolves.toEqual({
            status: 'ERROR',
            error: 'selfhosted does not support fetchRun',
        });
        const events = [];
        for await (const ev of streamAgentRun({ provider: 'smoke', agentId: 'a' }, emptyCtx)) {
            events.push(ev);
        }
        expect(events[0]?.eventType).toBe('error');
        expect((events[0]?.payload as { code?: string }).code).toBe('unsupported');
    });
});

describe('mapCursorStreamEvent remaining types', () => {
    it('maps status thinking tool_call result error unknown', () => {
        expect(
            mapCursorStreamEvent({ type: 'status', status: 'RUNNING', runId: 'r' }),
        ).toMatchObject({
            eventType: 'status',
            payload: { status: 'RUNNING', runId: 'r' },
        });
        expect(mapCursorStreamEvent({ type: 'thinking', text: '...' })).toMatchObject({
            eventType: 'message',
            payload: { role: 'thinking' },
        });
        expect(
            mapCursorStreamEvent({
                type: 'tool_call',
                callId: 'c',
                name: 'n',
                status: 'completed',
                args: {},
                result: 'ok',
                truncated: false,
            }),
        ).toMatchObject({ eventType: 'tool_call' });
        expect(
            mapCursorStreamEvent({
                type: 'result',
                status: 'FINISHED',
                runId: 'r',
                text: 't',
                durationMs: 1,
                prUrl: 'https://x',
            }),
        ).toMatchObject({ eventType: 'result' });
        expect(mapCursorStreamEvent({ type: 'error', code: 'x', message: 'm' })).toMatchObject({
            eventType: 'error',
        });
        expect(mapCursorStreamEvent({ type: 'weird' as 'done' })).toMatchObject({
            eventType: 'meta',
            payload: { kind: 'unknown' },
        });
    });
});

describe('normalizeAgentModelInput', () => {
    it('handles empty, bare, composite and object', () => {
        expect(normalizeAgentModelInput(undefined, 'cursor')).toEqual({
            provider: 'cursor',
            modelId: 'auto',
        });
        expect(normalizeAgentModelInput('  ', 'selfhosted')).toEqual({
            provider: 'selfhosted',
            modelId: 'auto',
        });
        expect(normalizeAgentModelInput('composer-2.5', 'selfhosted')).toEqual({
            provider: 'selfhosted',
            modelId: 'composer-2.5',
        });
        expect(normalizeAgentModelInput('cursor:fast')).toEqual({
            provider: 'cursor',
            modelId: 'fast',
        });
        const obj = { provider: 'cursor' as const, modelId: 'x' };
        expect(normalizeAgentModelInput(obj)).toBe(obj);
        expect(formatAgentModelRef(obj)).toBe('cursor:x');
    });
});

describe('registry success paths and unknown provider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws when provider id is not registered', async () => {
        await expect(listAgentModels('unknown' as 'cursor', emptyCtx)).rejects.toThrow(
            'agent provider not registered: unknown',
        );
    });

    it('createAgentRun / fetchAgentRun / streamAgentRun succeed for cursor', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                const u = String(url);
                if (u.includes('/agents') && !u.includes('/runs')) {
                    return new Response(
                        JSON.stringify({
                            agent: { id: 'ag1' },
                            run: { id: 'run1', status: 'CREATING' },
                        }),
                        { status: 200 },
                    );
                }
                if (u.endsWith('/stream')) {
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(
                                new TextEncoder().encode('event: done\ndata: {}\n\n'),
                            );
                            controller.close();
                        },
                    });
                    return new Response(stream, { status: 200 });
                }
                return new Response(
                    JSON.stringify({
                        status: 'FINISHED',
                        result: 'done',
                        git: { branches: [{ prUrl: 'https://github.com/o/r/pull/1' }] },
                    }),
                    { status: 200 },
                );
            }),
        );

        const created = await createAgentRun(
            { repoUrl: 'https://github.com/o/r', promptText: 'x' },
            ctx,
        );
        expect(created.ok).toBe(true);

        const fetched = await fetchAgentRun(
            { provider: 'cursor', agentId: 'ag1', runId: 'run1' },
            ctx,
        );
        expect(fetched).toMatchObject({
            status: 'FINISHED',
            resultText: 'done',
            prUrl: 'https://github.com/o/r/pull/1',
            terminal: true,
        });

        const events = [];
        for await (const ev of streamAgentRun(
            { provider: 'cursor', agentId: 'ag1', runId: 'run1' },
            ctx,
        )) {
            events.push(ev);
        }
        expect(events.some((e) => e.eventType === 'meta' || e.eventType === 'result')).toBe(true);
    });
});
