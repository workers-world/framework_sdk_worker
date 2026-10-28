import { describe, expect, it } from 'vitest';
import {
    emptyTokenMetrics,
    filterMessagesForRun,
    sumTokenMetricsFromMessages,
    totalTokens,
} from '../../src/provider-adapter/token-metrics.js';

describe('sumTokenMetricsFromMessages', () => {
    it('sums assistant token fields and cost', () => {
        const metrics = sumTokenMetricsFromMessages([
            { type: 'user', text: 'review' },
            {
                type: 'assistant',
                tokens: {
                    input: 100,
                    output: 40,
                    reasoning: 10,
                    cache: { read: 5, write: 2 },
                },
                cost: 0.001,
            },
            {
                type: 'assistant',
                tokens: {
                    input: 20,
                    output: 10,
                    reasoning: 0,
                    cache: { read: 0, write: 1 },
                },
                cost: 0.0005,
            },
        ]);
        expect(metrics.tokens_input).toBe(120);
        expect(metrics.tokens_output).toBe(50);
        expect(metrics.tokens_reasoning).toBe(10);
        expect(metrics.tokens_cache_read).toBe(5);
        expect(metrics.tokens_cache_write).toBe(3);
        expect(metrics.cost_usd).toBeCloseTo(0.0015);
        expect(totalTokens(metrics)).toBe(188);
    });

    it('tolerates missing tokens', () => {
        const metrics = sumTokenMetricsFromMessages([{ type: 'assistant', text: 'ok' }]);
        expect(metrics.tokens_input).toBe(0);
        expect(metrics.cost_usd).toBe(0);
    });

    it('filters by msg_ + operationId prefix and does not fall back to whole session', () => {
        const op = 'rev-abc-review';
        const metrics = sumTokenMetricsFromMessages(
            [
                {
                    id: 'msg_rev-old-review',
                    type: 'assistant',
                    tokens: { input: 999, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                    cost: 1,
                },
                {
                    id: `msg_${op}`,
                    type: 'assistant',
                    tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
                    cost: 0.01,
                },
            ],
            { operationId: op },
        );
        expect(metrics.tokens_input).toBe(10);
        expect(metrics.tokens_output).toBe(2);
        expect(metrics.tokens_cache_read).toBe(1);
        expect(metrics.cost_usd).toBeCloseTo(0.01);
    });

    it('returns empty when filter matches nothing (no ses_root fallback)', () => {
        const metrics = sumTokenMetricsFromMessages(
            [
                {
                    id: 'msg_other',
                    type: 'assistant',
                    tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
                },
            ],
            { operationId: 'rev-missing' },
        );
        expect(metrics).toEqual(emptyTokenMetrics());
    });

    it('filters by sinceMs when id miss', () => {
        const since = Date.parse('2026-10-28T10:00:00.000Z');
        const metrics = sumTokenMetricsFromMessages(
            [
                {
                    id: 'msg_unrelated',
                    type: 'assistant',
                    time: { created: '2026-10-28T09:00:00.000Z' },
                    tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                },
                {
                    id: 'msg_unrelated2',
                    type: 'assistant',
                    time: { created: '2026-10-28T10:01:00.000Z' },
                    tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
                },
            ],
            { sinceMs: since },
        );
        expect(metrics.tokens_input).toBe(7);
        expect(metrics.tokens_output).toBe(3);
    });

    it('filterMessagesForRun keeps matched only', () => {
        const op = 'rev-x';
        const filtered = filterMessagesForRun(
            [
                { id: `msg_${op}`, type: 'assistant' },
                { id: 'msg_other', type: 'assistant' },
            ],
            { operationId: op },
        );
        expect(filtered).toHaveLength(1);
    });
});
