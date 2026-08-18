import {describe, expect, it, vi} from 'vitest';
import {mapWithConcurrency} from '../../src/async/map-with-concurrency.js';

describe('mapWithConcurrency', () => {
    it('returns empty for empty input', async () => {
        const mapper = vi.fn();
        await expect(mapWithConcurrency([], 3, mapper)).resolves.toEqual([]);
        expect(mapper).not.toHaveBeenCalled();
    });

    it('maps all items', async () => {
        const out = await mapWithConcurrency([1, 2, 3], 2, async (value) => value * 2);
        expect(out).toEqual([2, 4, 6]);
    });

    it('limits concurrent executions', async () => {
        let active = 0;
        let maxActive = 0;
        const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return value;
        });
        expect(out).toEqual([1, 2, 3, 4, 5]);
        expect(maxActive).toBeLessThanOrEqual(2);
    });
});
