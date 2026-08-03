import { describe, expect, it } from 'vitest';
import {
    extractAiErrorMessage,
    fetchTodayNeuronsUsed,
    hasNeuronQuotaRemaining,
    isNeuronQuotaError,
    isWorkersAiMetric,
    neuronQuotaStatus,
    secondsUntilNextUtcDay,
    utcDayRangeIso,
    utcYmdDash,
} from '../../src/ai/neuron-quota.js';

describe('neuron-quota', () => {
    it('utcYmdDash uses UTC calendar day', () => {
        const date = new Date('2026-07-09T02:00:00Z');
        expect(utcYmdDash(date)).toBe('2026-07-09');
    });

    it('utcDayRangeIso covers UTC natural day', () => {
        const date = new Date('2026-07-09T15:30:00Z');
        expect(utcDayRangeIso(date)).toEqual({
            start: '2026-07-09T00:00:00Z',
            end: '2026-07-10T00:00:00Z',
        });
    });

    it('secondsUntilNextUtcDay targets UTC next day with buffer', () => {
        const date = new Date('2026-07-09T15:30:00Z');
        expect(secondsUntilNextUtcDay(date)).toBe(8 * 3600 + 30 * 60 + 5 * 60);
    });

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
});
