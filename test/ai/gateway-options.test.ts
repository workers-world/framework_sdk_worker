import { describe, expect, it, vi } from 'vitest';
import { limitsFromPortalRow, promptBudgetBytes } from '../../src/ai/client.js';
import { aiGatewayRunOptions, callAiModel } from '../../src/ai/gateway.js';

describe('aiGatewayRunOptions', () => {
    it('透传平台 timeout / tags / eventId', () => {
        const options = aiGatewayRunOptions(
            { gatewayId: 'gtw_invest' },
            {
                requestTimeoutMs: 25_000,
                tags: ['desk:draft-gen', 'trace:abc'],
                eventId: 'evt-1',
            },
        ) as {
            tags?: string[];
            gateway: { id: string; requestTimeoutMs?: number; eventId?: string };
        };
        expect(options.gateway.id).toBe('gtw_invest');
        expect(options.gateway.requestTimeoutMs).toBe(25_000);
        expect(options.gateway.eventId).toBe('evt-1');
        expect(options.tags).toEqual(['desk:draft-gen', 'trace:abc']);
    });
});

describe('callAiModel extras', () => {
    it('把 signal 交给 AI.run', async () => {
        const run = vi.fn(async () => ({ response: 'ok' }));
        const ai = { run } as unknown as Ai;
        const signal = AbortSignal.timeout(5_000);
        await callAiModel(
            ai,
            'openai/gpt-5.4',
            { messages: [{ role: 'user', content: 'hi' }] },
            undefined,
            {
                signal,
                tags: ['caller:test'],
            },
        );
        expect(run).toHaveBeenCalledOnce();
        const opts = run.mock.calls[0]?.[2] as { signal?: AbortSignal; tags?: string[] };
        expect(opts.signal).toBe(signal);
        expect(opts.tags).toEqual(['caller:test']);
    });
});

describe('portal model limits', () => {
    it('从 properties 读取 context_window', () => {
        const limits = limitsFromPortalRow({
            id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            properties: [{ property_id: 'context_window', value: '24000' }],
            transport_max_bytes: 32768,
        });
        expect(limits.contextWindowTokens).toBe(24_000);
        expect(limits.transportMaxBytes).toBe(32_768);
        expect(promptBudgetBytes(limits, 1500, 1000)).toBe(32_768 - 1000);
    });
});
