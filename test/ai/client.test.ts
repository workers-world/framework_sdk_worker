import { describe, expect, it, vi } from 'vitest';
import {
    chatGeneral,
    getModelLimits,
    resetModelLimitsCache,
    resolveLlmCallTimeoutMs,
} from '../../src/ai/client.js';

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

describe('resolveLlmCallTimeoutMs', () => {
    it('defaults to 25s and clamps invalid / huge values', () => {
        expect(resolveLlmCallTimeoutMs()).toBe(25_000);
        expect(resolveLlmCallTimeoutMs(0)).toBe(25_000);
        expect(resolveLlmCallTimeoutMs(-1)).toBe(25_000);
        expect(resolveLlmCallTimeoutMs(Number.NaN)).toBe(25_000);
        expect(resolveLlmCallTimeoutMs(45_000)).toBe(45_000);
        expect(resolveLlmCallTimeoutMs(999_000)).toBe(120_000);
    });
});

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

    it('uses AbortSignal.timeout with default 25s and optional timeoutMs', async () => {
        const { fetcher, calls } = fakeGateway();
        await chatGeneral(
            { SVC_LLM_GATEWAY: fetcher, LLM_GATEWAY_AUTH_TOKEN: 'tok' },
            { model: 'm', messages: [{ role: 'user', content: 'ping' }], timeoutMs: 45_000 },
        );
        const signal = calls[0].init.signal as AbortSignal | undefined;
        expect(signal).toBeDefined();
        expect(signal?.aborted).toBe(false);
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

    it('maps portal 413 without re-enforcing locally', async () => {
        const fetcher = {
            fetch: async () =>
                new Response(
                    JSON.stringify({
                        error: 'transport_exceeded',
                        estimated: 90_000,
                        limit: 32_768,
                        model: 'dynamic/invest-fallback',
                    }),
                    { status: 413 },
                ),
        } as unknown as Fetcher;
        const result = await chatGeneral(
            { SVC_LLM_GATEWAY: fetcher, LLM_GATEWAY_AUTH_TOKEN: 'tok' },
            {
                model: 'dynamic/invest-fallback',
                messages: [{ role: 'user', content: 'x'.repeat(100) }],
            },
        );
        expect(result.ok).toBe(false);
        expect(result.status).toBe(413);
        expect(result.error).toContain('transport_exceeded');
        expect(result.error).toContain('estimated=90000');
        expect(result.error).toContain('limit=32768');
    });

    it('reads enriched catalog from GET /v1/models/:id', async () => {
        resetModelLimitsCache();
        const calls: string[] = [];
        const fetcher = {
            fetch: async (url: string) => {
                calls.push(url);
                return new Response(
                    JSON.stringify({
                        id: 'dynamic/invest-fallback',
                        object: 'model',
                        properties: [{ property_id: 'context_window', value: '24000' }],
                        transport_max_bytes: 32768,
                        resolved_from: [
                            '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
                            'openai/gpt-5.4',
                        ],
                    }),
                    { status: 200 },
                );
            },
        } as unknown as Fetcher;
        const limits = await getModelLimits(
            { SVC_LLM_GATEWAY: fetcher, LLM_GATEWAY_AUTH_TOKEN: 'tok' },
            'dynamic/invest-fallback',
        );
        expect(calls[0]).toContain('/v1/models/dynamic%2Finvest-fallback');
        expect(limits?.contextWindowTokens).toBe(24_000);
        expect(limits?.transportMaxBytes).toBe(32_768);
        expect(limits?.raw?.resolved_from).toEqual([
            '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            'openai/gpt-5.4',
        ]);
    });

    it('tiers negative cache: 404 long, transient errors short', async () => {
        // 回归：任何 !resp.ok 一律负缓存 60s，门户 5xx 抖动会把 limits 卡满一分钟
        vi.useFakeTimers();
        let calls = 0;
        let status = 500;
        const fetcher = {
            fetch: async () => {
                calls += 1;
                return new Response('{}', { status });
            },
        } as unknown as Fetcher;
        const env = { SVC_LLM_GATEWAY: fetcher, LLM_GATEWAY_AUTH_TOKEN: 'tok' };

        // 5xx：短负缓存 5s，窗口内不重查，过后重查
        await expect(getModelLimits(env, 'm-transient')).resolves.toBeNull();
        await expect(getModelLimits(env, 'm-transient')).resolves.toBeNull();
        expect(calls).toBe(1);
        vi.advanceTimersByTime(6_000);
        await expect(getModelLimits(env, 'm-transient')).resolves.toBeNull();
        expect(calls).toBe(2);

        // 404：长负缓存 60s
        status = 404;
        await expect(getModelLimits(env, 'm-missing')).resolves.toBeNull();
        expect(calls).toBe(3);
        vi.advanceTimersByTime(30_000);
        await expect(getModelLimits(env, 'm-missing')).resolves.toBeNull();
        expect(calls).toBe(3);
        vi.advanceTimersByTime(40_000);
        await expect(getModelLimits(env, 'm-missing')).resolves.toBeNull();
        expect(calls).toBe(4);

        vi.useRealTimers();
        resetModelLimitsCache();
    });
});
