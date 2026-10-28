import { describe, expect, it } from 'vitest';
import {
    estimateCostUsdFromRateCard,
    getProviderAdapter,
    listProviderAdapterIds,
    OPENCODE_GO_KIMI_K27_CODE_RATES,
    parseOpenCodeGoModelId,
} from '../../src/provider-adapter/index.js';

describe('provider-adapter registry', () => {
    it('registers default adapters', () => {
        const ids = listProviderAdapterIds();
        expect(ids).toContain('workers_ai_gateway');
        expect(ids).toContain('opencode_go');
        expect(ids).toContain('cursor');
    });

    it('exposes capability bits', () => {
        expect(getProviderAdapter('workers_ai_gateway').capabilities).toMatchObject({
            bindModel: true,
            usage: true,
            billing: true,
            quota: false,
        });
        expect(getProviderAdapter('opencode_go').capabilities.quota).toBe(true);
        expect(getProviderAdapter('cursor').capabilities.billing).toBe(false);
    });

    it('throws on unknown id', () => {
        expect(() => getProviderAdapter('nope')).toThrow(/not registered/);
    });
});

describe('opencode_go bindModel + billing', () => {
    it('parses model id', () => {
        expect(parseOpenCodeGoModelId('opencode-go/kimi-k2.7-code')).toEqual({
            providerID: 'opencode-go',
            id: 'kimi-k2.7-code',
        });
        expect(parseOpenCodeGoModelId('@cf/x')).toBeNull();
    });

    it('bindModel sets parsed model', async () => {
        const adapter = getProviderAdapter('opencode_go');
        let set: unknown;
        await adapter.bindModel?.(
            {
                setModel: async (m) => {
                    set = m;
                },
            },
            {
                modelId: 'opencode-go/kimi-k2.7-code',
                runId: 'r1',
                owner: 'o',
                repo: 'r',
                pr: 1,
            },
        );
        expect(set).toEqual({ providerID: 'opencode-go', id: 'kimi-k2.7-code' });
    });

    it('resolveBilling uses rate_card when message cost is 0', async () => {
        const adapter = getProviderAdapter('opencode_go');
        const usage = await adapter.resolveUsage({
            messages: [
                {
                    id: 'msg_rev-sha-review',
                    type: 'user',
                    text: 'review',
                },
                {
                    id: 'msg_1591409e0003aspemQUovklFoN',
                    type: 'assistant',
                    tokens: {
                        input: 1_000_000,
                        output: 0,
                        reasoning: 0,
                        cache: { read: 0, write: 0 },
                    },
                    cost: 0,
                },
            ],
            operationId: 'rev-sha-review',
        });
        const billing = await adapter.resolveBilling({
            usage,
            runId: 'run-1',
            startedAtMs: Date.now(),
            modelId: 'opencode-go/kimi-k2.7-code',
        });
        expect(billing.source).toBe('rate_card');
        expect(billing.costUsd).toBeCloseTo(OPENCODE_GO_KIMI_K27_CODE_RATES.inputPer1M);
    });

    it('estimateCostUsdFromRateCard arithmetic', () => {
        expect(
            estimateCostUsdFromRateCard(
                {
                    tokens_input: 1_000_000,
                    tokens_output: 1_000_000,
                    tokens_reasoning: 0,
                    tokens_cache_read: 0,
                    tokens_cache_write: 0,
                },
                OPENCODE_GO_KIMI_K27_CODE_RATES,
            ),
        ).toBeCloseTo(
            OPENCODE_GO_KIMI_K27_CODE_RATES.inputPer1M +
                OPENCODE_GO_KIMI_K27_CODE_RATES.outputPer1M,
        );
    });
});

describe('workers_ai_gateway bindModel', () => {
    it('requires ai binding', async () => {
        const adapter = getProviderAdapter('workers_ai_gateway');
        await expect(
            adapter.bindModel?.(
                { setModel: async () => {} },
                {
                    modelId: '@cf/moonshotai/kimi-k2.7-code',
                    runId: 'r',
                    owner: 'o',
                    repo: 'r',
                    pr: 1,
                },
            ),
        ).rejects.toThrow(/requires_ai_binding/);
    });

    it('calls ai factory with gateway metadata', async () => {
        const adapter = getProviderAdapter('workers_ai_gateway');
        let set: unknown;
        let aiOpts: unknown;
        await adapter.bindModel?.(
            {
                setModel: async (m) => {
                    set = m;
                },
            },
            {
                modelId: '@cf/moonshotai/kimi-k2.7-code',
                runId: 'run-9',
                owner: 'ww',
                repo: 'mok1',
                pr: 74,
                ai: (modelId, opts) => {
                    aiOpts = { modelId, opts };
                    return { kind: 'gateway-model', modelId };
                },
            },
        );
        expect(set).toEqual({ kind: 'gateway-model', modelId: '@cf/moonshotai/kimi-k2.7-code' });
        expect(aiOpts).toMatchObject({
            modelId: '@cf/moonshotai/kimi-k2.7-code',
            opts: {
                reasoningEffort: 'low',
                metadata: {
                    runId: 'run-9',
                    owner: 'ww',
                    repo: 'mok1',
                    pr: '74',
                },
            },
        });
    });
});
