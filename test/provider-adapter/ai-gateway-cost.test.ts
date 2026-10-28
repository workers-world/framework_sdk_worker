import { describe, expect, it, vi } from 'vitest';
import {
    AI_GATEWAY_LOGS_PER_PAGE,
    awaitAiGatewayCostUsd,
    buildReviewGatewayMetadata,
    fetchAiGatewayCostOnce,
    resolveReviewCostUsd,
    sumAiGatewayCostUsd,
} from '../../src/provider-adapter/ai-gateway-cost.js';

describe('buildReviewGatewayMetadata', () => {
    it('uses four keys within AI Gateway metadata limit', () => {
        expect(
            buildReviewGatewayMetadata({
                runId: 'run-1',
                owner: 'workers-world',
                repo: 'mok1',
                pr: 74,
            }),
        ).toEqual({
            runId: 'run-1',
            owner: 'workers-world',
            repo: 'mok1',
            pr: '74',
        });
    });
});

describe('fetchAiGatewayCostOnce / sumAiGatewayCostUsd', () => {
    it('uses per_page at most 50 for Gateway logs API', () => {
        expect(AI_GATEWAY_LOGS_PER_PAGE).toBe(50);
    });

    it('requests per_page=50 in the logs URL', async () => {
        let requestedUrl = '';
        const fetchImpl = async (url: string) => {
            requestedUrl = url;
            return new Response(
                JSON.stringify({
                    success: true,
                    result: [],
                    result_info: { total_pages: 1 },
                }),
            );
        };
        await fetchAiGatewayCostOnce({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl: fetchImpl as typeof fetch,
        });
        expect(requestedUrl).toContain('per_page=50');
    });

    it('returns null without credentials (legacy sum)', async () => {
        await expect(
            sumAiGatewayCostUsd({
                gatewayId: 'default',
                runId: 'abc',
                startedAtMs: Date.now(),
            }),
        ).resolves.toBeNull();
    });

    it('sums cost for matching runId metadata', async () => {
        const fetchImpl = async () =>
            new Response(
                JSON.stringify({
                    success: true,
                    result: [
                        { cost: 0.001, metadata: { runId: 'run-1' } },
                        { cost: 0.002, metadata: { runId: 'run-1' } },
                        { cost: 9, metadata: { runId: 'other' } },
                    ],
                    result_info: { total_pages: 1 },
                }),
            );

        const once = await fetchAiGatewayCostOnce({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
        });
        expect(once).toEqual({ status: 'ok', costUsd: 0.003, matched: 2 });
    });
});

describe('awaitAiGatewayCostUsd', () => {
    it('retries after matched=0 then succeeds', async () => {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            if (calls < 3) {
                return new Response(
                    JSON.stringify({
                        success: true,
                        result: [],
                        result_info: { total_pages: 1 },
                    }),
                );
            }
            return new Response(
                JSON.stringify({
                    success: true,
                    result: [{ cost: 0.004, metadata: { runId: 'run-1' } }],
                    result_info: { total_pages: 1 },
                }),
            );
        };

        const log = vi.fn();
        const sleep = vi.fn(async () => {});

        const result = await awaitAiGatewayCostUsd({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
            sleep,
            log,
            maxAttempts: 5,
            initialDelayMs: 1,
        });

        expect(result).toEqual({
            outcome: 'ok',
            costUsd: 0.004,
            matched: 1,
            attempts: 3,
        });
        expect(calls).toBe(3);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith(
            'ai_gateway_cost_matched_zero',
            expect.objectContaining({ attempt: 1 }),
        );
        expect(log).toHaveBeenCalledWith(
            'ai_gateway_cost_matched',
            expect.objectContaining({ matched: 1 }),
        );
    });

    it('retries on API error then succeeds', async () => {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('error', { status: 503 });
            }
            return new Response(
                JSON.stringify({
                    success: true,
                    result: [{ cost: 0.01, metadata: { runId: 'run-1' } }],
                    result_info: { total_pages: 1 },
                }),
            );
        };

        const log = vi.fn();
        const result = await awaitAiGatewayCostUsd({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
            sleep: async () => {},
            log,
            maxAttempts: 4,
            initialDelayMs: 1,
        });

        expect(result.outcome).toBe('ok');
        expect(log).toHaveBeenCalledWith(
            'ai_gateway_cost_api_error',
            expect.objectContaining({ httpStatus: 503, attempt: 1 }),
        );
    });

    it('returns ok with zero after exhausted retries with empty logs', async () => {
        const fetchImpl = async () =>
            new Response(
                JSON.stringify({
                    success: true,
                    result: [],
                    result_info: { total_pages: 1 },
                }),
            );

        const result = await awaitAiGatewayCostUsd({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
            sleep: async () => {},
            maxAttempts: 3,
            initialDelayMs: 1,
        });

        expect(result).toEqual({
            outcome: 'ok',
            costUsd: 0,
            matched: 0,
            attempts: 3,
        });
    });

    it('returns no_credentials without calling fetch', async () => {
        const fetchImpl = vi.fn();
        const result = await awaitAiGatewayCostUsd({
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
            sleep: async () => {},
        });
        expect(result).toEqual({ outcome: 'no_credentials' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns api_failed when API never succeeds', async () => {
        const fetchImpl = async () => new Response('nope', { status: 500 });
        const result = await awaitAiGatewayCostUsd({
            accountId: 'acc',
            apiToken: 'token',
            gatewayId: 'default',
            runId: 'run-1',
            startedAtMs: Date.now(),
            fetchImpl,
            sleep: async () => {},
            maxAttempts: 2,
            initialDelayMs: 1,
        });
        expect(result).toEqual({
            outcome: 'api_failed',
            attempts: 2,
            lastHttpStatus: 500,
        });
    });
});

describe('resolveReviewCostUsd', () => {
    it('uses gateway totals when outcome ok', () => {
        expect(
            resolveReviewCostUsd({
                gateway: { outcome: 'ok', costUsd: 0.5, matched: 2, attempts: 1 },
                messageCostUsd: 0.1,
            }),
        ).toEqual({ costUsd: 0.5, costSource: 'ai_gateway' });
    });

    it('uses ai_gateway with zero when gateway ok but matched zero (empty-log policy)', () => {
        expect(
            resolveReviewCostUsd({
                gateway: { outcome: 'ok', costUsd: 0, matched: 0, attempts: 6 },
                messageCostUsd: 0.1,
            }),
        ).toEqual({ costUsd: 0, costSource: 'ai_gateway' });
    });

    it('falls back to message cost when credentials missing', () => {
        expect(
            resolveReviewCostUsd({
                gateway: { outcome: 'no_credentials' },
                messageCostUsd: 0.1,
            }),
        ).toEqual({ costUsd: 0.1, costSource: 'message_fallback' });
    });

    it('falls back to message cost when API failed after retries', () => {
        expect(
            resolveReviewCostUsd({
                gateway: { outcome: 'api_failed', attempts: 6, lastHttpStatus: 503 },
                messageCostUsd: 0.2,
            }),
        ).toEqual({ costUsd: 0.2, costSource: 'message_fallback' });
    });

    it('returns none when gateway unavailable and no message cost', () => {
        expect(
            resolveReviewCostUsd({
                gateway: { outcome: 'api_failed', attempts: 3 },
                messageCostUsd: 0,
            }),
        ).toEqual({ costUsd: 0, costSource: 'none' });
    });
});
