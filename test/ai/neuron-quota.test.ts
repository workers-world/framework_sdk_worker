import { describe, expect, it } from 'vitest';
import {
    extractAiErrorMessage,
    fetchTodayNeuronsUsed,
    hasNeuronQuotaRemaining,
    isNeuronQuotaError,
    isWorkersAiMetric,
    neuronQuotaStatus,
} from '../../src/ai/neuron-quota.js';

describe('neuron-quota', () => {
    it('isWorkersAiMetric matches neuron metrics', () => {
        expect(isWorkersAiMetric({ x_BillableMetricId: 'workers_ai_neurons' })).toBe(true);
        expect(isWorkersAiMetric({ ServiceName: 'Workers AI' })).toBe(true);
        expect(isWorkersAiMetric({ ServiceName: 'R2' })).toBe(false);
    });

    it('isNeuronQuotaError detects 4006', () => {
        expect(isNeuronQuotaError('4006: daily free allocation')).toBe(true);
        expect(isNeuronQuotaError('NEURON_QUOTA_EXCEEDED')).toBe(true);
        expect(isNeuronQuotaError('network timeout')).toBe(false);
    });

    it('isNeuronQuotaError requires quota context around 4006 (misjudge guard)', () => {
        // 回归：裸 '4006' 子串曾把无关报错误判为当日配额耗尽，导致网关全站 429 到次日
        expect(
            isNeuronQuotaError('AiError: you have exceeded your daily free allocation (4006)'),
        ).toBe(true);
        expect(isNeuronQuotaError('error code 4006, neuron quota exceeded')).toBe(true);
        // 反例：token 数 / 参数值恰好包含 4006
        expect(isNeuronQuotaError('token count 40060 exceeds model limit')).toBe(false);
        expect(isNeuronQuotaError('invalid value for steps=4006')).toBe(false);
        expect(isNeuronQuotaError('4006')).toBe(false);
    });

    it('extractAiErrorMessage handles AiError objects', () => {
        const aiError = {
            name: 'AiError',
            internalCode: 4006,
            message:
                'AiError: AiError: you have used up your daily free allocation of 10,000 neurons',
            description: 'you have used up your daily free allocation of 10,000 neurons',
        };
        expect(extractAiErrorMessage(aiError)).toContain('daily free allocation');
        expect(isNeuronQuotaError(aiError)).toBe(true);
        expect(isNeuronQuotaError({ internalCode: 4006 })).toBe(true);
    });

    it('extractAiErrorMessage falls back for plain objects', () => {
        expect(extractAiErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
        expect(extractAiErrorMessage(null)).toBe('');
    });

    it('hasNeuronQuotaRemaining reserves headroom', () => {
        expect(hasNeuronQuotaRemaining(9000, 10000, 500)).toBe(true);
        expect(hasNeuronQuotaRemaining(9600, 10000, 500)).toBe(false);
    });

    it('neuronQuotaStatus computes remaining', () => {
        expect(neuronQuotaStatus(9500, 10000, 500)).toEqual({
            remaining: 500,
            exceeded: false,
        });
        expect(neuronQuotaStatus(9800, 10000, 500).exceeded).toBe(true);
    });

    it('fetchTodayNeuronsUsed sums GraphQL totalNeurons', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    data: {
                        viewer: {
                            accounts: [
                                {
                                    aiInferenceAdaptiveGroups: [
                                        { sum: { totalNeurons: 1200.5 } },
                                        { sum: { totalNeurons: 799.5 } },
                                    ],
                                },
                            ],
                        },
                    },
                }),
                { status: 200 },
            );

        try {
            const result = await fetchTodayNeuronsUsed(
                'acct',
                'token',
                new Date('2026-07-09T12:00:00Z'),
            );
            expect(result).toEqual({ ok: true, used: 2000 });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('fetchTodayNeuronsUsed surfaces GraphQL errors', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    errors: [{ message: 'auth failed' }],
                }),
                { status: 200 },
            );

        try {
            const result = await fetchTodayNeuronsUsed('acct', 'token');
            expect(result.ok).toBe(false);
            expect(result.error).toContain('graphql neurons query failed');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('fetchTodayNeuronsUsed covers network HTTP and non-JSON failures', async () => {
        const originalFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                throw 'offline';
            };
            await expect(fetchTodayNeuronsUsed('acct', 'token')).resolves.toEqual({
                ok: false,
                used: 0,
                error: 'offline',
            });

            globalThis.fetch = async () => new Response('nope', { status: 503 });
            await expect(fetchTodayNeuronsUsed('acct', 'token')).resolves.toMatchObject({
                ok: false,
                error: 'graphql neurons query failed: HTTP 503',
            });

            globalThis.fetch = async () => new Response('not-json', { status: 200 });
            await expect(fetchTodayNeuronsUsed('acct', 'token')).resolves.toMatchObject({
                ok: false,
                error: expect.stringContaining('非 JSON'),
            });

            globalThis.fetch = async () =>
                new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } } }), {
                    status: 200,
                });
            await expect(fetchTodayNeuronsUsed('acct', 'token')).resolves.toEqual({
                ok: true,
                used: 0,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('extractAiErrorMessage remaining shapes and quota phrasing', () => {
        expect(extractAiErrorMessage(new Error('boom'))).toBe('boom');
        expect(extractAiErrorMessage(12)).toBe('12');
        expect(extractAiErrorMessage({ description: 'from-desc' })).toBe('from-desc');
        expect(extractAiErrorMessage({ internalCode: 4006, foo: 1 })).toBe(
            '{"internalCode":4006,"foo":1}',
        );
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(extractAiErrorMessage(circular)).toBe(String(circular));
        expect(isNeuronQuotaError('please upgrade neurons plan')).toBe(true);
        expect(isWorkersAiMetric({ x_BillableMetricId: 'workers-ai-units' })).toBe(true);
    });
});
