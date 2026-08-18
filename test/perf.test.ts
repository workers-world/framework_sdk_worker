import {afterEach, describe, expect, it, vi} from 'vitest';
import {withCpuBudget} from '../src/perf.js';

describe('withCpuBudget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns fn result and does not warn under threshold', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        const result = withCpuBudget('fast', () => 42, {thresholdMs: 50});
        expect(result).toBe(42);
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns with structured event when over threshold', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        let calls = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            calls += 1;
            return calls === 1 ? 0 : 10;
        });

        const result = withCpuBudget('slow-label', () => 'ok', {thresholdMs: 5});
        expect(result).toBe('ok');
        expect(warn).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(String(warn.mock.calls[0][0])) as Record<string, unknown>;
        expect(payload.event).toBe('cpu_budget_exceeded');
        expect(payload.label).toBe('slow-label');
        expect(payload.elapsedMs).toBe(10);
        expect(payload.thresholdMs).toBe(5);
    });

    it('still warns when fn throws after exceeding threshold', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        let calls = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            calls += 1;
            return calls === 1 ? 0 : 8;
        });

        expect(() =>
            withCpuBudget(
                'throws',
                () => {
                    throw new Error('boom');
                },
                {thresholdMs: 5},
            ),
        ).toThrow('boom');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
