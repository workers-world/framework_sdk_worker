import { describe, expect, it, vi } from 'vitest';
import { chatGeneral } from '../../src/ai/client.js';

function fakeGateway() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = {
        fetch: async (url: string, init?: RequestInit) => {
            calls.push({ url, init: init ?? {} });
            return new Response(
                JSON.stringify({
                    choices: [{ message: { role: 'assistant', content: ' pong ' } }],
                }),
                { status: 200 },
            );
        },
    } as unknown as Fetcher;
    return { fetcher, calls };
}

describe('ai/client headers', () => {
    it('sends caller/dedupKey/traceId as correlation headers', async () => {
        const { fetcher, calls } = fakeGateway();
        const result = await chatGeneral(
            { SVC_LLM_GATEWAY: fetcher, LLM_GATEWAY_AUTH_TOKEN: 'tok' },
            {
                model: 'm',
                messages: [{ role: 'user', content: 'ping' }],
                caller: 'advisor-worker:advice-cluster',
                dedupKey: 'dk1',
                traceId: 'tr1',
            },
        );

        expect(result.ok).toBe(true);
        expect(result.content).toBe('pong');
        expect(calls).toHaveLength(1);
        const headers = calls[0].init.headers as Record<string, string>;
        expect(headers['X-Caller']).toBe('advisor-worker:advice-cluster');
        expect(headers['X-Dedup-Key']).toBe('dk1');
        expect(headers['X-Trace-Id']).toBe('tr1');
        expect(headers.Authorization).toBe('Bearer tok');
    });

    it('returns {ok:false} without binding or token instead of throwing', async () => {
        const noBinding = await chatGeneral(
            {},
            { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        );
        expect(noBinding.ok).toBe(false);

        const noToken = await chatGeneral(
            { SVC_LLM_GATEWAY: { fetch: vi.fn() } as unknown as Fetcher },
            { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        );
        expect(noToken.ok).toBe(false);
        expect(noToken.error).toContain('LLM_GATEWAY_AUTH_TOKEN');
    });
});
