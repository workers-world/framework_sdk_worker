import { describe, expect, it } from 'vitest';
import {
    emptyTokenMetrics,
    filterMessagesForRun,
    messagesForOperation,
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

    it('scopes by user msg_ operationId and sums random assistant ids after it', () => {
        const op = 'rev-abc-review';
        const metrics = sumTokenMetricsFromMessages(
            [
                {
                    id: 'msg_rev-old-review',
                    type: 'user',
                    text: 'old',
                },
                {
                    id: 'msg_randomOldAssistant',
                    type: 'assistant',
                    tokens: { input: 999, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                    cost: 1,
                },
                {
                    id: `msg_${op}`,
                    type: 'user',
                    text: 'review this sha',
                },
                {
                    id: 'msg_1591409e0003aspemQUovklFoN',
                    type: 'assistant',
                    tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
                    cost: 0.01,
                },
                {
                    id: 'msg_anotherRandomTurn',
                    type: 'assistant',
                    tokens: { input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                    cost: 0.001,
                },
            ],
            { operationId: op },
        );
        expect(metrics.tokens_input).toBe(13);
        expect(metrics.tokens_output).toBe(3);
        expect(metrics.tokens_cache_read).toBe(1);
        expect(metrics.cost_usd).toBeCloseTo(0.011);
    });

    it('stops at next user or idle after the operation root', () => {
        const op = 'rev-stop-review';
        const metrics = sumTokenMetricsFromMessages(
            [
                { id: `msg_${op}`, type: 'user', text: 'go' },
                {
                    id: 'msg_a1',
                    type: 'assistant',
                    tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                },
                { id: 'msg_next_user', type: 'user', text: 'later' },
                {
                    id: 'msg_after_user',
                    type: 'assistant',
                    tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                },
            ],
            { operationId: op },
        );
        expect(metrics.tokens_input).toBe(5);
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

    it('filters by sinceMs when user op message is missing', () => {
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
            { operationId: 'rev-compacted-away', sinceMs: since },
        );
        expect(metrics.tokens_input).toBe(7);
        expect(metrics.tokens_output).toBe(3);
    });

    it('filters by sinceMs only when no operationId', () => {
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

    it('filterMessagesForRun returns user op window', () => {
        const op = 'rev-x';
        const filtered = filterMessagesForRun(
            [
                { id: 'msg_rev-old', type: 'user' },
                { id: `msg_${op}`, type: 'user' },
                { id: 'msg_randomAssistant', type: 'assistant' },
                { id: 'msg_next_user', type: 'user' },
                { id: 'msg_other', type: 'assistant' },
            ],
            { operationId: op },
        );
        expect(filtered).toHaveLength(2);
        expect(filtered[0]).toMatchObject({ id: `msg_${op}`, type: 'user' });
        expect(filtered[1]).toMatchObject({ id: 'msg_randomAssistant', type: 'assistant' });
    });

    it('messagesForOperation mirrors harness slice', () => {
        const op = 'rev-y';
        const slice = messagesForOperation(
            [
                { id: `msg_${op}`, type: 'user' },
                { id: 'msg_a', type: 'assistant' },
                { type: 'idle' },
                { id: 'msg_tail', type: 'assistant' },
            ],
            op,
        );
        expect(slice).toHaveLength(2);
        expect(slice?.[1]).toMatchObject({ id: 'msg_a' });
    });
});
